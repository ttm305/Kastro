-- Web Push (VAPID) architecture for out-of-app notifications.
-- See supabase/migrations/README.md for the full design writeup, including
-- what still has to be configured manually post-deploy (Edge Function
-- secrets) that no available tool in this environment could set.

create extension if not exists pg_net;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists idx_push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select_self on public.push_subscriptions
  for select using (user_id = auth.uid());

create policy push_subscriptions_insert_self on public.push_subscriptions
  for insert with check (user_id = auth.uid());

create policy push_subscriptions_update_self on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy push_subscriptions_delete_self on public.push_subscriptions
  for delete using (user_id = auth.uid());

revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Register (or refresh) this browser's push subscription. Called after the
-- user grants Notification permission and the client obtains a
-- PushSubscription from the browser's Push API.
create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_endpoint is null or p_p256dh is null or p_auth is null then
    raise exception 'Missing subscription fields' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (user_id, endpoint) do update set
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    last_seen_at = now();
end;
$$;
revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- Called when the user disables push, or the browser invalidates a
-- subscription client-side.
create or replace function public.unregister_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  delete from public.push_subscriptions where user_id = auth.uid() and endpoint = p_endpoint;
end;
$$;
revoke all on function public.unregister_push_subscription(text) from public, anon;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- Whether *I* currently have at least one push subscription registered —
-- drives the enabled/disabled state of the toggle in Profile settings
-- without exposing endpoint/key material to the client.
create or replace function public.has_push_subscription()
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists(select 1 from public.push_subscriptions where user_id = auth.uid());
$$;
revoke all on function public.has_push_subscription() from public, anon;
grant execute on function public.has_push_subscription() to authenticated;

-- Internal-only secret shared between this database and the send-push Edge
-- Function, so the function can verify a request genuinely came from our
-- own trigger (rather than accepting any anonymous POST) without needing a
-- full user JWT flow for a server-to-server call. Never exposed via the
-- API: it lives in `private`, which PostgREST does not expose, and no
-- table/function here grants anon or authenticated any access to it.
create table if not exists private.app_secrets (
  key text primary key,
  value text not null
);
insert into private.app_secrets (key, value)
values ('push_internal_secret', '33bddc5367f4f825b4f638c8716e278e10fa182a202b9cb881b898d49aef17d7')
on conflict (key) do nothing;

-- Fires an async HTTP call (via pg_net — never blocks the caller) to the
-- send-push Edge Function for every message send that also creates an
-- in-app notification (i.e. the recipient isn't actively viewing the
-- conversation). The Edge Function itself looks up that user's
-- push_subscriptions rows and does the actual Web Push send — this
-- function's only job is "wake up the Edge Function for this user."
create or replace function private.send_push_for_new_message(p_user_id uuid, p_title text, p_title_ar text, p_body text, p_body_ar text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_secret text;
begin
  -- Skip the HTTP round-trip entirely if this user has no registered
  -- devices — the common case for anyone who has never enabled push.
  if not exists (select 1 from public.push_subscriptions where user_id = p_user_id) then
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
  -- A push-delivery failure must never fail the message send itself.
  null;
end;
$$;

-- send_message(): now also fires a push wake-up alongside the existing
-- in-app notification, under the exact same "recipient isn't actively
-- viewing" condition.
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
    perform private.send_push_for_new_message(
      v_other, coalesce(v_username, 'Someone'), coalesce(v_username, 'شخص ما'),
      v_preview, v_preview,
      jsonb_build_object('conversation_id', p_conversation_id, 'from_user_id', auth.uid(), 'from_username', v_username)
    );
  end if;

  return v_id;
end;
$$;
