-- Fixes two bugs in the Friends/Chat messaging system:
--
-- 1. Conversation threads were disappearing from "Chats" once their last
--    surviving message was cleaned up. Root cause: private.leave_conversation_for()
--    had no persistence guard, and get_my_conversations() additionally required a
--    currently-existing message row to include a conversation at all. Fix: keep
--    conversations.last_message_at as the permanent "history exists" marker (it is
--    never reset), and have get_my_conversations() key off last_message_at instead
--    of requiring a live message row.
--
-- 2. Adds "Save in Chat" / "Unsave" support: messages can be marked is_saved by
--    either participant via toggle_save_message(), which exempts them from the
--    ephemeral read-then-delete cleanup in private.leave_conversation_for().
--
-- 3. send_message() previously created "new_message" notifications with a null
--    title/body. It now includes "{sender username}: {short preview}" so in-app /
--    push notifications have real content.

alter table public.messages add column if not exists is_saved boolean not null default false;
alter table public.messages add column if not exists saved_at timestamptz;
alter table public.messages add column if not exists saved_by uuid references public.profiles(id) on delete set null;
create index if not exists idx_messages_saved on public.messages (conversation_id) where is_saved;

-- Toggle save/unsave on a message. Only a participant in the message's
-- conversation may call this (self-checked, not reliant on RLS alone).
create or replace function public.toggle_save_message(p_message_id uuid, p_save boolean)
returns public.messages
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_conversation_id uuid;
  v_ua uuid;
  v_ub uuid;
  v_row public.messages;
begin
  select conversation_id into v_conversation_id from public.messages where id = p_message_id;
  if v_conversation_id is null then
    raise exception 'Message not found' using errcode = '22023';
  end if;

  select user_a, user_b into v_ua, v_ub from public.conversations where id = v_conversation_id;
  if auth.uid() not in (v_ua, v_ub) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  update public.messages set
    is_saved = p_save,
    saved_at = case when p_save then now() else null end,
    saved_by = case when p_save then auth.uid() else null end
  where id = p_message_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.toggle_save_message(uuid, boolean) from public, anon;
grant execute on function public.toggle_save_message(uuid, boolean) to authenticated;

-- Ephemeral cleanup: only ever deletes messages sent TO p_user_id that have
-- already been read AND are not saved. Never touches the conversation row
-- itself, so conversations.last_message_at (the permanent "history exists"
-- marker) is preserved even once every message has been cleaned up.
create or replace function private.leave_conversation_for(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  delete from public.messages
  where conversation_id = p_conversation_id
    and sender_id <> p_user_id
    and read_at is not null
    and not is_saved;

  update public.conversation_participants
  set is_viewing = false
  where conversation_id = p_conversation_id and user_id = p_user_id;
end;
$$;

-- Chats list: now keyed off conversations.last_message_at (permanent marker)
-- instead of requiring a currently-existing message row, so a conversation
-- with real history stays listed even after all ephemeral messages have been
-- cleaned up. Also surfaces last_message_saved so the frontend can show a
-- distinct "saved message" preview vs. an empty-state after cleanup.
drop function if exists public.get_my_conversations();
create function public.get_my_conversations()
returns table(
  conversation_id uuid,
  other_user_id uuid,
  last_message_body text,
  last_message_at timestamptz,
  last_message_from_me boolean,
  last_message_saved boolean,
  unread_count int,
  other_is_viewing boolean
)
language sql
stable
security definer
set search_path to 'public', 'private'
as $$
  select
    c.id,
    case when c.user_a = auth.uid() then c.user_b else c.user_a end,
    lm.body,
    c.last_message_at,
    lm.sender_id = auth.uid(),
    coalesce(lm.is_saved, false),
    (select count(*)::int from public.messages m2
       where m2.conversation_id = c.id and m2.sender_id <> auth.uid() and m2.read_at is null),
    coalesce((select cp2.is_viewing from public.conversation_participants cp2
       where cp2.conversation_id = c.id and cp2.user_id <> auth.uid()), false)
  from public.conversations c
  left join lateral (
    select body, sender_id, is_saved from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where (c.user_a = auth.uid() or c.user_b = auth.uid())
    and c.last_message_at is not null
  order by c.last_message_at desc nulls last;
$$;

revoke all on function public.get_my_conversations() from public, anon;
grant execute on function public.get_my_conversations() to authenticated;

-- send_message(): now includes real notification content
-- ("{sender username}: {short preview}") instead of null/null, and this
-- remains the only place last_message_at is ever set going forward.
create or replace function public.send_message(p_conversation_id uuid, p_body text, p_client_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_other uuid;
  v_id uuid;
  v_ua uuid;
  v_ub uuid;
  v_username text;
  v_preview text;
begin
  select user_a, user_b into v_ua, v_ub from public.conversations where id = p_conversation_id;
  if v_ua is null then
    raise exception 'Conversation not found' using errcode = '22023';
  end if;
  if auth.uid() not in (v_ua, v_ub) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  v_other := case when v_ua = auth.uid() then v_ub else v_ua end;

  if private.is_blocked(auth.uid(), v_other) then
    raise exception 'Blocked' using errcode = '22023';
  end if;

  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'Empty message' using errcode = '22023';
  end if;

  insert into public.messages (conversation_id, sender_id, body, client_message_id)
  values (p_conversation_id, auth.uid(), left(trim(p_body), 2000), p_client_message_id)
  on conflict (conversation_id, sender_id, client_message_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- Retry of an already-processed send (idempotency): return the
    -- original message id rather than erroring or creating a duplicate.
    select id into v_id from public.messages
    where conversation_id = p_conversation_id
      and sender_id = auth.uid()
      and client_message_id = p_client_message_id;
    return v_id;
  end if;

  update public.conversations set last_message_at = now() where id = p_conversation_id;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = v_other and is_viewing
  ) then
    select username into v_username from public.profiles where id = auth.uid();
    v_preview := left(trim(p_body), 80);
    perform private.notify(
      v_other, 'new_message', 'New message', 'رسالة جديدة',
      coalesce(v_username, 'Someone') || ': ' || v_preview,
      coalesce(v_username, 'شخص ما') || ': ' || v_preview,
      jsonb_build_object('conversation_id', p_conversation_id, 'from_user_id', auth.uid(), 'from_username', v_username)
    );
  end if;

  return v_id;
end;
$$;
