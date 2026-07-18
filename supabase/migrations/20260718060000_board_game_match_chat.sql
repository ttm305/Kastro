-- ============================================================
-- In-game match chat (bug report item 2 — "add chat like Plato").
--
-- New, dedicated table — deliberately NOT the friends `messages` table.
-- Match chat is scoped to a board_game_rooms row (host + seated players +
-- spectators), not a friend pair, and must NOT inherit the disappearing/
-- hard-delete-on-leave retention rule that table carries (see
-- 20260716200629_friends_chat_tables.sql's comment on `messages`) — this
-- delivery was explicit that match chat must not accidentally pick that up.
-- Retention here: messages live as long as the room row does (same
-- lifetime as board_game_moves, which already persists indefinitely for
-- match replay) and are cascade-deleted only if the room itself is ever
-- deleted (e.g. leave_board_game_room's "close an empty waiting room"
-- path from the previous migration in this delivery).
-- ============================================================

create table if not exists public.board_game_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.board_game_rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) >= 1 and char_length(body) <= 500),
  client_message_id uuid not null,
  created_at timestamptz not null default now(),
  unique (room_id, sender_id, client_message_id)
);
create index if not exists idx_board_game_messages_room on public.board_game_messages (room_id, created_at);

alter table public.board_game_messages enable row level security;

drop policy if exists board_game_messages_select on public.board_game_messages;
create policy board_game_messages_select on public.board_game_messages for select
  using (private.is_board_game_room_member(room_id, (select auth.uid())));
-- No insert/update/delete policy — all writes go through send_board_game_message()
-- below (SECURITY DEFINER), same RPC-only pattern as every other table in
-- this project that carries user-generated content.

revoke all on public.board_game_messages from anon, authenticated;
grant select on public.board_game_messages to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_game_messages') then
    alter publication supabase_realtime add table public.board_game_messages;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- send_board_game_message: validates membership + body, inserts (idempotent
-- on client_message_id retry), and notifies every other room member who
-- is NOT actively present in the match right now — "actively present" is
-- read from board_game_players.last_heartbeat_at, the same freshness
-- signal already used by get_presence()/sweep_stale_board_game_players()
-- (20260717193802_fix_stale_game_presence.sql) rather than a new
-- is_viewing flag, since the match screen already sends a heartbeat every
-- ~10-15s while mounted (see boardGameHeartbeat in src/lib/api.ts) — no
-- new client wiring needed for presence to be accurate. A player whose
-- heartbeat has gone stale (backgrounded, left the match screen, killed
-- the tab) gets both the in-app notification and a push, exactly
-- mirroring send_message()'s is_viewing-gated notify+push pattern for
-- friend chat.
-- ---------------------------------------------------------------------
create or replace function public.send_board_game_message(p_room_id uuid, p_body text, p_client_message_id uuid)
returns uuid
language plpgsql security definer set search_path to 'public', 'private'
as $$
declare
  v_id uuid;
  v_body text;
  v_username text;
  v_preview text;
  v_room_status text;
  r record;
begin
  if not private.is_board_game_room_member(p_room_id, auth.uid()) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  v_body := left(trim(coalesce(p_body, '')), 500);
  if v_body = '' then
    raise exception 'Empty message' using errcode = '22023';
  end if;

  insert into public.board_game_messages (room_id, sender_id, body, client_message_id)
  values (p_room_id, auth.uid(), v_body, p_client_message_id)
  on conflict (room_id, sender_id, client_message_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- Idempotent retry (client resent after a dropped ack) — return the
    -- already-inserted row, notify nobody again.
    select id into v_id from public.board_game_messages
    where room_id = p_room_id and sender_id = auth.uid() and client_message_id = p_client_message_id;
    return v_id;
  end if;

  select username into v_username from public.profiles where id = auth.uid();
  v_preview := left(v_body, 80);
  select status into v_room_status from public.board_game_rooms where id = p_room_id;

  for r in
    select p.user_id from public.board_game_players p
    where p.room_id = p_room_id
      and p.left_at is null
      and p.user_id is not null
      and p.user_id <> auth.uid()
      and not p.is_ai
      and not (p.is_connected and p.last_heartbeat_at > now() - interval '90 seconds')
  loop
    perform private.notify(
      r.user_id, 'match_chat', 'Match chat', 'دردشة المباراة',
      coalesce(v_username, 'Someone') || ': ' || v_preview,
      coalesce(v_username, 'شخص ما') || ': ' || v_preview,
      jsonb_build_object('room_id', p_room_id, 'from_user_id', auth.uid(), 'from_username', v_username)
    );
    perform private.send_push_notification(
      r.user_id, coalesce(v_username, 'Someone'), coalesce(v_username, 'شخص ما'),
      v_preview, v_preview,
      jsonb_build_object('room_id', p_room_id, 'from_user_id', auth.uid(), 'from_username', v_username)
    );
  end loop;

  return v_id;
end;
$$;

revoke all on function public.send_board_game_message(uuid, text, uuid) from public, anon;
grant execute on function public.send_board_game_message(uuid, text, uuid) to authenticated;
