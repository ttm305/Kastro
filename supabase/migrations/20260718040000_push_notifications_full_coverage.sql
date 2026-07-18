-- =========================================================================
-- Push notifications: extend beyond chat messages to tournaments,
-- challenges, and friend requests.
--
-- CONTEXT: the existing Web Push architecture (20260717182201, plus native
-- push in 20260718001500) only ever fired for one event: a new chat
-- message, via private.send_push_for_new_message() -> pg_net ->
-- the send-push Edge Function. Live investigation (get_logs against the
-- edge-function service) shows every one of those calls has actually been
-- returning 403 Forbidden — not the "skipped: vapid_not_configured" 200
-- the Edge Function returns when VAPID/FCM env vars are simply absent, but
-- a hard 403, which only happens when x-internal-secret fails to match
-- (PUSH_INTERNAL_SECRET itself unset makes INTERNAL_SECRET === '', which
-- the function's `!INTERNAL_SECRET` check always rejects). This confirms:
-- the DB -> Edge Function wiring for chat has been firing correctly the
-- entire time; no push has ever been delivered because the four Edge
-- Function secrets documented in supabase/migrations/README.md were never
-- actually set (no tool available in any Claude session so far can set
-- Edge Function secrets — that requires the Supabase CLI or Dashboard).
-- That manual step is still required after this migration; see the
-- delivery notes for the exact command.
--
-- CHANGES IN THIS MIGRATION:
--   1. private.send_push_for_new_message() is renamed to the generic
--      private.send_push_notification() — its body was never actually
--      message-specific (just a user_id + title/body/data pass-through),
--      only its name was. send_message() is updated to call the new name.
--   2. New private.send_push_broadcast() — same pg_net wake-up pattern,
--      but for the "notify every active user" case (tournament/challenge
--      creation), mirroring how private.notify_all_active() already does
--      one bulk in-app insert instead of one insert per user. Sends a
--      single Edge Function call with `broadcast: true`; the Edge
--      Function itself (updated alongside this migration, see
--      supabase/functions/send-push/index.ts) fans out to every
--      active user's stored subscriptions/tokens server-side, rather than
--      this DB function looping and firing one HTTP call per user (which
--      would not scale and would hammer pg_net for no benefit).
--   3. send_friend_request() now also fires a single-user push, alongside
--      its existing in-app private.notify() call.
--   4. admin_create_tournament() and admin_create_challenge() now also
--      fire a broadcast push, alongside their existing
--      private.notify_all_active() call.
-- =========================================================================

-- ---------------------------------------------------------------------
-- 1. Rename send_push_for_new_message -> send_push_notification (generic).
-- ---------------------------------------------------------------------
create or replace function private.send_push_notification(p_user_id uuid, p_title text, p_title_ar text, p_body text, p_body_ar text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_secret text;
begin
  if not exists (select 1 from public.push_subscriptions where user_id = p_user_id)
     and not exists (select 1 from public.native_push_tokens where user_id = p_user_id) then
    return;
  end if;

  select value into v_secret from private.app_secrets where key = 'push_internal_secret';
  if v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://pagwybefqbnqrqigvvrw.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    body := jsonb_build_object('user_id', p_user_id, 'title', p_title, 'title_ar', p_title_ar, 'body', p_body, 'body_ar', p_body_ar, 'data', p_data),
    timeout_milliseconds := 5000
  );
exception when others then
  -- A push-delivery failure must never fail the caller's real mutation.
  null;
end;
$$;

drop function if exists private.send_push_for_new_message(uuid, text, text, text, text, jsonb);

-- ---------------------------------------------------------------------
-- 2. New broadcast helper (tournament / challenge creation).
-- ---------------------------------------------------------------------
create or replace function private.send_push_broadcast(p_title text, p_title_ar text, p_body text, p_body_ar text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_secret text;
begin
  if not exists (
    select 1 from public.push_subscriptions ps join public.profiles p on p.id = ps.user_id where p.status = 'active'
    union all
    select 1 from public.native_push_tokens nt join public.profiles p on p.id = nt.user_id where p.status = 'active'
  ) then
    return;
  end if;

  select value into v_secret from private.app_secrets where key = 'push_internal_secret';
  if v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://pagwybefqbnqrqigvvrw.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    body := jsonb_build_object('broadcast', true, 'title', p_title, 'title_ar', p_title_ar, 'body', p_body, 'body_ar', p_body_ar, 'data', p_data),
    timeout_milliseconds := 8000
  );
exception when others then
  null;
end;
$$;
revoke all on function private.send_push_notification(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.send_push_broadcast(text, text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. send_message(): update the call site to the renamed function.
--    Everything else about this function is unchanged.
-- ---------------------------------------------------------------------
create or replace function public.send_message(p_conversation_id uuid, p_body text, p_client_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'private'
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
    perform private.send_push_notification(
      v_other, coalesce(v_username, 'Someone'), coalesce(v_username, 'شخص ما'),
      v_preview, v_preview,
      jsonb_build_object('conversation_id', p_conversation_id, 'from_user_id', auth.uid(), 'from_username', v_username)
    );
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. send_friend_request(): add a single-user push alongside the existing
--    in-app notify() call.
-- ---------------------------------------------------------------------
create or replace function public.send_friend_request(p_recipient_id uuid)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_id uuid; v_username text; begin
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
  perform private.send_push_notification(p_recipient_id,
    'New friend request', 'طلب صداقة جديد',
    v_username || ' wants to be your friend', v_username || ' يريد أن يكون صديقك',
    jsonb_build_object('requester_id', auth.uid(), 'request_id', v_id));

  return v_id;
end; $$;

-- ---------------------------------------------------------------------
-- 5. admin_create_tournament() / admin_create_challenge(): add a broadcast
--    push alongside the existing notify_all_active() in-app broadcast.
--    Everything else about both functions (including the
--    log_admin_action fix from the previous migration) is unchanged.
-- ---------------------------------------------------------------------
create or replace function public.admin_create_tournament(p_name text, p_name_ar text, p_qualification_rule text, p_qualification_rule_ar text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone)
returns tournaments
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_row public.tournaments; begin
  perform private.require_owner();
  insert into public.tournaments (name, name_ar, qualification_rule, qualification_rule_ar, starts_at, ends_at, status)
  values (p_name, p_name_ar, coalesce(p_qualification_rule,''), coalesce(p_qualification_rule_ar,''), p_starts_at, p_ends_at, 'upcoming')
  returning * into v_row;

  perform private.notify_all_active('tournament', 'New tournament: ' || p_name, 'بطولة جديدة: ' || p_name_ar,
    'Registration is now open', 'التسجيل مفتوح الآن', jsonb_build_object('tournament_id', v_row.id));
  perform private.send_push_broadcast('New tournament: ' || p_name, 'بطولة جديدة: ' || p_name_ar,
    'Registration is now open', 'التسجيل مفتوح الآن', jsonb_build_object('tournament_id', v_row.id));

  perform private.log_admin_action(auth.uid(), 'Create Tournament', 'tournaments', p_name, 'Created', null::uuid, null::text, null::text);
  return v_row;
end; $$;

create or replace function public.admin_create_challenge(p_period_type text, p_title text, p_title_ar text, p_game_id text, p_question_count integer, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_xp_reward integer default null::integer, p_coin_reward integer default null::integer)
returns challenges
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_row public.challenges; begin
  perform private.require_owner();
  if p_period_type not in ('daily','weekly','monthly','seasonal') then
    raise exception 'Invalid period_type' using errcode = '22023';
  end if;

  insert into public.challenges (period_type, title, title_ar, game_id, question_count, starts_at, ends_at, xp_reward, coin_reward)
  values (
    p_period_type, p_title, p_title_ar, nullif(p_game_id,''), coalesce(p_question_count,10), p_starts_at, p_ends_at,
    coalesce(p_xp_reward, case p_period_type when 'daily' then 30 when 'weekly' then 100 when 'monthly' then 250 else 400 end),
    coalesce(p_coin_reward, case p_period_type when 'daily' then 15 when 'weekly' then 30 when 'monthly' then 60 else 100 end)
  )
  returning * into v_row;

  perform private.notify_all_active(p_period_type || '_challenge', p_title, p_title_ar,
    'A new challenge just started', 'بدأ تحدٍ جديد', jsonb_build_object('challenge_id', v_row.id));
  perform private.send_push_broadcast(p_title, p_title_ar,
    'A new challenge just started', 'بدأ تحدٍ جديد', jsonb_build_object('challenge_id', v_row.id));

  perform private.log_admin_action(auth.uid(), 'Create Challenge', 'challenges', p_title, p_period_type, null::uuid, null::text, null::text);
  return v_row;
end; $$;
