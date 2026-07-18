-- ============================================================
-- Friends + disappearing-chat — Phase 1: tables, indexes, RLS
-- Applied directly to the live project (pagwybefqbnqrqigvvrw) via the
-- Supabase MCP tool; this file is a faithful reconstruction of that
-- migration (introspected back out of the live schema) so it's versioned
-- in the repo. Re-running it against a fresh clone of this project is
-- safe and idempotent (guards on existing columns/policies).
-- ============================================================

-- Durable "last active" layer for presence. is_online continues to be
-- touched by touch_presence()/mark_offline(); last_seen_at backs the
-- "active 5m ago" offline display. Live "in a match right now" is never
-- read from a column — it's derived at query time in get_presence() from
-- board_game_players/match_room_players, so it can't be spoofed by a
-- stale/incorrectly-cleared client flag.
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- ---------------------------------------------------------------------
-- Blocking
-- ---------------------------------------------------------------------
create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint blocks_check check (blocker_id <> blocked_id),
  unique (blocker_id, blocked_id)
);
create index if not exists idx_blocks_blocked on public.blocks (blocked_id);

alter table public.blocks enable row level security;
drop policy if exists blocks_select on public.blocks;
create policy blocks_select on public.blocks for select
  using (blocker_id = (select auth.uid()) or blocked_id = (select auth.uid()) or current_role_is_owner());
-- No insert/update/delete policy: all writes go through block_user()/unblock_user()
-- (SECURITY DEFINER), never a direct table write from the client.

-- ---------------------------------------------------------------------
-- Reports — the owner's only window into message content, and only a
-- point-in-time snapshot captured when the report is filed (see
-- report_user() below), never a live view of the conversation.
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid,
  reason text not null,
  message_snapshot jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists idx_reports_status on public.reports (status, created_at desc);

alter table public.reports enable row level security;
drop policy if exists reports_select_own_or_owner on public.reports;
create policy reports_select_own_or_owner on public.reports for select
  using (reporter_id = (select auth.uid()) or current_role_is_owner());
-- No insert policy: all writes go through report_user() (SECURITY DEFINER).

-- ---------------------------------------------------------------------
-- Conversations — exactly one row per unordered friend pair, enforced by
-- the canonical-ordering check + unique constraint (same pattern already
-- used by friendships). This is what guarantees normal chat and in-game
-- chat resolve to the same thread, never a duplicate.
-- ---------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint conversations_check check (user_a < user_b),
  unique (user_a, user_b)
);
create index if not exists idx_conversations_a on public.conversations (user_a);
create index if not exists idx_conversations_b on public.conversations (user_b);

alter table public.conversations enable row level security;
drop policy if exists conversations_select_participant on public.conversations;
create policy conversations_select_participant on public.conversations for select
  using (user_a = (select auth.uid()) or user_b = (select auth.uid()));
-- Deliberately no owner-bypass clause here (unlike blocks/reports above) —
-- the owner must never be able to browse conversations directly.

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz,
  is_viewing boolean not null default false,
  last_heartbeat_at timestamptz,
  draft_text text,
  primary key (conversation_id, user_id)
);
create index if not exists idx_conv_participants_user on public.conversation_participants (user_id);
create index if not exists idx_conv_participants_viewing on public.conversation_participants (is_viewing) where is_viewing;

alter table public.conversation_participants enable row level security;
drop policy if exists conv_participants_select on public.conversation_participants;
create policy conv_participants_select on public.conversation_participants for select
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_participants.conversation_id
        and (c.user_a = (select auth.uid()) or c.user_b = (select auth.uid()))
    )
  );
drop policy if exists conv_participants_update_own on public.conversation_participants;
create policy conv_participants_update_own on public.conversation_participants for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- update_own intentionally exists (unlike the other tables here) so the
-- client can persist draft_text directly; read-state/viewing/heartbeat
-- mutations still go through the dedicated RPCs below for correctness,
-- but nothing prevents a well-behaved client writing its own draft.

-- ---------------------------------------------------------------------
-- Messages — no soft-delete flag anywhere. When a message is done, the
-- row is hard-deleted server-side (see private.leave_conversation_for in
-- the functions migration) — never just hidden from the client.
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) >= 1 and char_length(body) <= 2000),
  client_message_id uuid not null,
  source text not null default 'chat' check (source in ('chat', 'game')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  unique (conversation_id, sender_id, client_message_id)
);
create index if not exists idx_messages_conversation on public.messages (conversation_id, created_at);
create index if not exists idx_messages_unread on public.messages (conversation_id) where read_at is null;

alter table public.messages enable row level security;
drop policy if exists messages_select_participant on public.messages;
create policy messages_select_participant on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user_a = (select auth.uid()) or c.user_b = (select auth.uid()))
    )
  );
-- No insert/update/delete policy: all writes go through send_message() /
-- open_conversation() / leave_conversation() (SECURITY DEFINER) — a
-- client cannot fabricate a message, mark something read, or delete
-- anything by crafting a direct request.

-- Realtime: durable state (messages/conversations/participants) rides the
-- standard postgres_changes publication. Typing indicators are Realtime
-- Broadcast (ephemeral, no table); online/away is Realtime Presence
-- (channel.track()), also no table — only is_online/last_seen_at persist.
-- Wrapped so re-running this migration against a project that already has
-- these tables in the publication doesn't error.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations') then
    alter publication supabase_realtime add table public.conversations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_participants') then
    alter publication supabase_realtime add table public.conversation_participants;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
