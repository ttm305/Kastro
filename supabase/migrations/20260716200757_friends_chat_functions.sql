-- ============================================================
-- Friends + disappearing-chat — Phase 1: RPCs, presence, deletion
-- lifecycle, and the pg_cron sweep for ungraceful disconnects.
-- Reconstructed from the live project's pg_proc/cron.job definitions —
-- see 20260716200629_friends_chat_tables.sql for the schema this depends on.
-- ============================================================

-- ---------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------
create or replace function private.are_friends(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'private'
as $$
  select exists(select 1 from public.friendships where user_a=least(a,b) and user_b=greatest(a,b));
$$;

create or replace function private.is_blocked(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'private'
as $$
  select exists(select 1 from public.blocks where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a));
$$;

-- ---------------------------------------------------------------------
-- Blocking
-- ---------------------------------------------------------------------
create or replace function public.block_user(p_blocked_id uuid)
returns void
language plpgsql security definer set search_path to 'public', 'private'
as $$
begin
  if p_blocked_id = auth.uid() then raise exception 'Cannot block yourself' using errcode='22023'; end if;

  insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), p_blocked_id)
  on conflict do nothing;

  delete from public.friend_requests
  where (requester_id = auth.uid() and recipient_id = p_blocked_id)
     or (requester_id = p_blocked_id and recipient_id = auth.uid());

  delete from public.friendships
  where user_a = least(auth.uid(), p_blocked_id) and user_b = greatest(auth.uid(), p_blocked_id);
end;
$$;

create or replace function public.unblock_user(p_blocked_id uuid)
returns void
language sql security definer set search_path to 'public', 'private'
as $$
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_blocked_id;
$$;

-- Patched to reject requests to/from a blocked user (was previously
-- missing the block check entirely).
create or replace function public.send_friend_request(p_recipient_id uuid)
returns uuid
language plpgsql security definer set search_path to 'public', 'private'
as $$
declare v_id uuid; v_username text;
begin
  if p_recipient_id = auth.uid() then raise exception 'Cannot friend yourself' using errcode='22023'; end if;
  if private.is_blocked(auth.uid(), p_recipient_id) then raise exception 'Blocked' using errcode='22023'; end if;
  if exists (select 1 from public.friendships where (user_a=auth.uid() and user_b=p_recipient_id) or (user_a=p_recipient_id and user_b=auth.uid())) then
    raise exception 'Already friends' using errcode='22023';
  end if;
  insert into public.friend_requests (requester_id, recipient_id)
  values (auth.uid(), p_recipient_id)
  on conflict (requester_id, recipient_id) do update set status='pending', created_at=now(), responded_at=null
  returning id into v_id;

  select username into v_username from public.profiles where id = auth.uid();
  perform private.notify(p_recipient_id, 'friend_request',
    'New friend request', 'طلب صداقة جديد',
    v_username || ' wants to be your friend', v_username || ' يريد أن يكون صديقك',
    jsonb_build_object('requester_id', auth.uid(), 'request_id', v_id));

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Conversations + messages
-- ---------------------------------------------------------------------
create or replace function public.get_or_create_conversation(p_other_user_id uuid)
returns uuid
language plpgsql security definer set search_path to 'public', 'private'
as $$
declare v_a uuid; v_b uuid; v_id uuid;
begin
  if p_other_user_id = auth.uid() then raise exception 'Cannot message yourself' using errcode='22023'; end if;
  if not private.are_friends(auth.uid(), p_other_user_id) then raise exception 'Not friends' using errcode='22023'; end if;
  if private.is_blocked(auth.uid(), p_other_user_id) then raise exception 'Blocked' using errcode='22023'; end if;

  v_a := least(auth.uid(), p_other_user_id);
  v_b := greatest(auth.uid(), p_other_user_id);

  insert into public.conversations (user_a, user_b) values (v_a, v_b)
  on conflict (user_a, user_b) do update set user_a = excluded.user_a
  returning id into v_id;

  insert into public.conversation_participants (conversation_id, user_id) values (v_id, v_a) on conflict do nothing;
  insert into public.conversation_participants (conversation_id, user_id) values (v_id, v_b) on conflict do nothing;

  return v_id;
end;
$$;

create or replace function public.send_message(p_conversation_id uuid, p_body text, p_client_message_id uuid)
returns uuid
language plpgsql security definer set search_path to 'public', 'private'
as $$
declare v_other uuid; v_id uuid; v_ua uuid; v_ub uuid;
begin
  select user_a, user_b into v_ua, v_ub from public.conversations where id = p_conversation_id;
  if v_ua is null then raise exception 'Conversation not found' using errcode='22023'; end if;
  if auth.uid() not in (v_ua, v_ub) then raise exception 'Forbidden' using errcode='42501'; end if;
  v_other := case when v_ua = auth.uid() then v_ub else v_ua end;
  if private.is_blocked(auth.uid(), v_other) then raise exception 'Blocked' using errcode='22023'; end if;
  if p_body is null or length(trim(p_body)) = 0 then raise exception 'Empty message' using errcode='22023'; end if;

  insert into public.messages (conversation_id, sender_id, body, client_message_id)
  values (p_conversation_id, auth.uid(), left(trim(p_body), 2000), p_client_message_id)
  on conflict (conversation_id, sender_id, client_message_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- Idempotent retry (client resent after a dropped ack): return the
    -- already-inserted row's id, create nothing new, notify nobody again.
    select id into v_id from public.messages
    where conversation_id = p_conversation_id and sender_id = auth.uid() and client_message_id = p_client_message_id;
    return v_id;
  end if;

  update public.conversations set last_message_at = now() where id = p_conversation_id;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = v_other and is_viewing
  ) then
    perform private.notify(v_other, 'new_message', 'New message', 'رسالة جديدة', null, null,
      jsonb_build_object('conversation_id', p_conversation_id, 'from_user_id', auth.uid()));
  end if;

  return v_id;
end;
$$;

-- Opening the conversation: mark everything the other side has sent me as
-- read (clears my unread badge immediately) and flag myself as viewing.
-- Deliberately does NOT delete anything — deletion only happens on leave.
create or replace function public.open_conversation(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path to 'public', 'private'
as $$
begin
  if not exists (select 1 from public.conversations where id = p_conversation_id and (user_a = auth.uid() or user_b = auth.uid())) then
    raise exception 'Forbidden' using errcode='42501';
  end if;

  update public.messages set read_at = now()
  where conversation_id = p_conversation_id and sender_id <> auth.uid() and read_at is null;

  update public.conversation_participants
  set is_viewing = true, last_heartbeat_at = now(), last_read_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid();
end;
$$;

create or replace function public.heartbeat_conversation(p_conversation_id uuid)
returns void
language sql security definer set search_path to 'public', 'private'
as $$
  update public.conversation_participants set last_heartbeat_at = now(), is_viewing = true
  where conversation_id = p_conversation_id and user_id = auth.uid();
$$;

-- The actual deletion trigger: hard-deletes everything addressed to
-- p_user_id that they have already read. Messages they haven't read yet,
-- or messages they sent themselves, are untouched by their own leave.
-- Shared by the interactive leave_conversation() RPC and the pg_cron sweep
-- below, so both paths enforce identical semantics.
create or replace function private.leave_conversation_for(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path to 'public', 'private'
as $$
begin
  delete from public.messages
  where conversation_id = p_conversation_id and sender_id <> p_user_id and read_at is not null;

  update public.conversation_participants
  set is_viewing = false
  where conversation_id = p_conversation_id and user_id = p_user_id;

  update public.conversations c
  set last_message_at = (select max(m.created_at) from public.messages m where m.conversation_id = c.id)
  where c.id = p_conversation_id;
end;
$$;

create or replace function public.leave_conversation(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path to 'public', 'private'
as $$
begin
  if not exists (select 1 from public.conversations where id = p_conversation_id and (user_a = auth.uid() or user_b = auth.uid())) then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  perform private.leave_conversation_for(p_conversation_id, auth.uid());
end;
$$;

-- Ungraceful-exit safety net: any participant flagged is_viewing whose
-- heartbeat has gone stale (tab killed, app backgrounded, network drop)
-- is treated as having left, and gets the same deletion sweep run for
-- them. Scheduled via pg_cron below, once a minute.
create or replace function private.sweep_stale_conversation_viewers()
returns void
language plpgsql security definer set search_path to 'public', 'private'
as $$
declare r record;
begin
  for r in
    select conversation_id, user_id from public.conversation_participants
    where is_viewing and last_heartbeat_at < now() - interval '90 seconds'
  loop
    perform private.leave_conversation_for(r.conversation_id, r.user_id);
  end loop;
end;
$$;

create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'sweep-stale-conversation-viewers',
  '* * * * *',
  $$select private.sweep_stale_conversation_viewers();$$
) where not exists (select 1 from cron.job where jobname = 'sweep-stale-conversation-viewers');

-- Reporting: snapshots message content into the report row at the moment
-- it's filed — the owner's only way to see message content, and only for
-- reported conversations, never a live/browsable inbox.
create or replace function public.report_user(p_reported_user_id uuid, p_conversation_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path to 'public', 'private'
as $$
declare v_snapshot jsonb; v_id uuid;
begin
  if p_conversation_id is not null then
    if not exists (select 1 from public.conversations where id = p_conversation_id and (user_a = auth.uid() or user_b = auth.uid())) then
      raise exception 'Forbidden' using errcode='42501';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('sender_id', sender_id, 'body', body, 'created_at', created_at) order by created_at), '[]'::jsonb)
    into v_snapshot
    from public.messages where conversation_id = p_conversation_id;
  else
    v_snapshot := '[]'::jsonb;
  end if;

  insert into public.reports (reporter_id, reported_user_id, conversation_id, reason, message_snapshot)
  values (auth.uid(), p_reported_user_id, p_conversation_id, coalesce(p_reason, ''), v_snapshot)
  returning id into v_id;

  return v_id;
end;
$$;

-- The Chats-tab inbox query: one row per conversation that still has at
-- least one surviving message (so a fully-drained conversation doesn't
-- show up as a misleading blank row), latest activity first.
create or replace function public.get_my_conversations()
returns table(
  conversation_id uuid,
  other_user_id uuid,
  last_message_body text,
  last_message_at timestamptz,
  last_message_from_me boolean,
  unread_count int,
  other_is_viewing boolean
)
language sql stable security definer set search_path to 'public', 'private'
as $$
  select
    c.id,
    case when c.user_a = auth.uid() then c.user_b else c.user_a end,
    lm.body,
    c.last_message_at,
    lm.sender_id = auth.uid(),
    (select count(*)::int from public.messages m2 where m2.conversation_id = c.id and m2.sender_id <> auth.uid() and m2.read_at is null),
    coalesce((select cp2.is_viewing from public.conversation_participants cp2 where cp2.conversation_id = c.id and cp2.user_id <> auth.uid()), false)
  from public.conversations c
  left join lateral (
    select body, sender_id from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1
  ) lm on true
  where (c.user_a = auth.uid() or c.user_b = auth.uid())
    and lm.body is not null
  order by c.last_message_at desc nulls last;
$$;

-- ---------------------------------------------------------------------
-- Presence
-- ---------------------------------------------------------------------
create or replace function public.touch_presence()
returns void
language sql security definer set search_path to 'public', 'private'
as $$
  update public.profiles set is_online = true, last_seen_at = now() where id = auth.uid();
$$;

create or replace function public.mark_offline()
returns void
language sql security definer set search_path to 'public', 'private'
as $$
  update public.profiles set is_online = false, last_seen_at = now() where id = auth.uid();
$$;

-- Server-verified presence: is_in_game is derived from live board-game /
-- match-room membership at query time, never from a client-claimed flag.
create or replace function public.get_presence(p_ids uuid[])
returns table(
  id uuid,
  is_online boolean,
  last_seen_at timestamptz,
  is_in_game boolean,
  game_name text,
  game_name_ar text
)
language sql stable security definer set search_path to 'public', 'private'
as $$
  select p.id, p.is_online, p.last_seen_at,
    (bg.user_id is not null or mr.user_id is not null),
    coalesce(g1.name, g2.name), coalesce(g1.name_ar, g2.name_ar)
  from public.profiles p
  left join lateral (
    select bgp.user_id, bgr.game_id from public.board_game_players bgp
    join public.board_game_rooms bgr on bgr.id = bgp.room_id and bgr.status = 'active'
    where bgp.user_id = p.id and bgp.left_at is null limit 1
  ) bg on true
  left join lateral (
    select mrp.user_id, mr2.game_id from public.match_room_players mrp
    join public.match_rooms mr2 on mr2.id = mrp.room_id and mr2.status in ('active','in_progress')
    where mrp.user_id = p.id and mrp.left_at is null limit 1
  ) mr on true
  left join public.games g1 on g1.id = bg.game_id
  left join public.games g2 on g2.id = mr.game_id
  where p.id = any(p_ids);
$$;
