-- Native push (FCM/APNs, via Firebase Cloud Messaging) for a Capacitor-
-- wrapped iOS/Android build, layered alongside the existing Web Push
-- (VAPID) architecture in 20260717182201_push_notifications_schema.sql.
--
-- Why a separate table instead of extending push_subscriptions: a Web
-- Push subscription is fundamentally a 3-part credential (endpoint +
-- p256dh + auth) tied to one browser's Push API registration; a native
-- FCM token is a single opaque string tied to one app install. Making
-- push_subscriptions' p256dh/auth nullable to accommodate both shapes
-- would weaken that table's existing NOT NULL guarantees for every
-- current (working, already-in-production) Web Push row for no benefit —
-- a dedicated table keeps both models simple and lets RLS/cleanup logic
-- stay identical in shape without conditional branching per platform.
create table if not exists public.native_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('ios','android')),
  token text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, token)
);

create index if not exists idx_native_push_tokens_user on public.native_push_tokens (user_id);

alter table public.native_push_tokens enable row level security;

create policy native_push_tokens_select_self on public.native_push_tokens
  for select using (user_id = auth.uid());

create policy native_push_tokens_insert_self on public.native_push_tokens
  for insert with check (user_id = auth.uid());

create policy native_push_tokens_update_self on public.native_push_tokens
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy native_push_tokens_delete_self on public.native_push_tokens
  for delete using (user_id = auth.uid());

revoke all on public.native_push_tokens from anon;
grant select, insert, update, delete on public.native_push_tokens to authenticated;

-- Register (or refresh) this device's FCM token. Called by
-- src/lib/nativePush.ts after PushNotifications.register() resolves with
-- a token inside a Capacitor-native build. A device that reinstalls the
-- app gets a new token from Apple/Google, so this is an upsert keyed on
-- (user_id, token), same pattern as register_push_subscription — multiple
-- rows per user is the intended multi-device case (phone + tablet, or a
-- reinstall before the old token is pruned by send-push's own stale-token
-- cleanup).
create or replace function public.register_native_push_token(p_platform text, p_token text)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_platform not in ('ios','android') then
    raise exception 'Invalid platform' using errcode = '22023';
  end if;
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'Missing token' using errcode = '22023';
  end if;
  insert into public.native_push_tokens (user_id, platform, token)
  values (auth.uid(), p_platform, p_token)
  on conflict (user_id, token) do update set
    platform = excluded.platform,
    last_seen_at = now();
end;
$$;
revoke all on function public.register_native_push_token(text, text) from public, anon;
grant execute on function public.register_native_push_token(text, text) to authenticated;

create or replace function public.unregister_native_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  delete from public.native_push_tokens where user_id = auth.uid() and token = p_token;
end;
$$;
revoke all on function public.unregister_native_push_token(text) from public, anon;
grant execute on function public.unregister_native_push_token(text) to authenticated;

-- has_push_subscription() drove the enabled/disabled state of the
-- Profile > Notifications toggle for Web Push only; a native-app user who
-- granted push permission had no way to show as "enabled" here. Widen it
-- to be platform-agnostic: true if this user has ANY registered device,
-- web or native. The toggle's meaning to the end user ("do I get
-- notified?") doesn't care which mechanism is behind it.
create or replace function public.has_push_subscription()
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select
    exists(select 1 from public.push_subscriptions where user_id = auth.uid())
    or exists(select 1 from public.native_push_tokens where user_id = auth.uid());
$$;

-- send_push_for_new_message() only skipped the wake-up call when a user
-- had zero *web* subscriptions; a native-only user (no browser push, only
-- the packaged app) would never get woken. Check both tables.
create or replace function private.send_push_for_new_message(p_user_id uuid, p_title text, p_title_ar text, p_body text, p_body_ar text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public, private
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
  null;
end;
$$;
