-- Security advisor caught two real gaps in the migrations just applied:
-- 1. ludo_submit_move / finalize_ludo_match were granted to `authenticated`
--    but never explicitly REVOKEd from PUBLIC/anon — Postgres grants EXECUTE
--    to PUBLIC by default on function creation, so both were still callable
--    unauthenticated (auth.uid() would be null, and both functions already
--    reject a null/unmatched caller, but there's no reason to leave the
--    surface open at all).
-- 2. The private.ludo_* pure helpers never pinned search_path, unlike the
--    two SECURITY DEFINER entry points — a mutable search_path is a known
--    Postgres privilege-escalation footgun even for functions only called
--    internally.

revoke execute on function public.ludo_submit_move(uuid, integer, jsonb) from public, anon;
revoke execute on function public.finalize_ludo_match(uuid) from public, anon;
grant execute on function public.ludo_submit_move(uuid, integer, jsonb) to authenticated;
grant execute on function public.finalize_ludo_match(uuid) to authenticated;

alter function private.ludo_global_cell(int, int) set search_path = public, private;
alter function private.ludo_is_safe_cell(int) set search_path = public, private;
alter function private.ludo_next_active_seat(jsonb, int) set search_path = public, private;
alter function private.ludo_legal_piece_ids(jsonb, int) set search_path = public, private;
alter function private.ludo_apply_piece_move(jsonb, int, int, int, text) set search_path = public, private;
alter function private.ludo_initial_state(int, int) set search_path = public, private;
