-- =========================================================================
-- Owner admin expansion — Part 4: player statistics correction RPC
--
-- Note on architecture: this app stores no standalone "losses" or "average
-- score" columns anywhere — both are always derived (losses = games_played
-- - wins; average = total_correct / total_questions), and leaderboard
-- points are always derived from xp/xp_ledger/season progress, never a
-- separately stored ranking value. This RPC therefore corrects only the
-- real, stored counters in user_game_stats and lets every derived value
-- (losses, averages, leaderboard points) fall out of that correction
-- automatically — it never writes a parallel, inconsistent aggregate.
-- =========================================================================

create or replace function public.admin_correct_user_game_stats(
  p_user_id uuid,
  p_game_id text,
  p_games_played integer,
  p_wins integer,
  p_current_streak integer,
  p_best_streak integer,
  p_total_correct integer,
  p_total_questions integer,
  p_best_score integer,
  p_reason text default 'Admin stat correction'
) returns public.user_game_stats
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_username text;
  v_game_name text;
  v_old public.user_game_stats;
  v_new public.user_game_stats;
begin
  perform private.require_owner();

  select username into v_username from public.profiles where id = p_user_id;
  if v_username is null then raise exception 'User not found' using errcode='22023'; end if;
  select name into v_game_name from public.games where id = p_game_id;
  if v_game_name is null then raise exception 'Unknown game' using errcode='22023'; end if;

  if p_games_played < 0 or p_wins < 0 or p_current_streak < 0 or p_best_streak < 0
     or p_total_correct < 0 or p_total_questions < 0 or p_best_score < 0 then
    raise exception 'Statistics cannot be negative' using errcode = '22023';
  end if;
  if p_wins > p_games_played then
    raise exception 'Wins cannot exceed games played' using errcode = '22023';
  end if;
  if p_total_correct > p_total_questions then
    raise exception 'Correct answers cannot exceed questions answered' using errcode = '22023';
  end if;
  if p_current_streak > p_best_streak then
    raise exception 'Current streak cannot exceed best streak' using errcode = '22023';
  end if;

  select * into v_old from public.user_game_stats where user_id = p_user_id and game_id = p_game_id;

  insert into public.user_game_stats (
    user_id, game_id, games_played, wins, current_streak, best_streak,
    total_correct, total_questions, best_score, updated_at
  ) values (
    p_user_id, p_game_id, p_games_played, p_wins, p_current_streak, p_best_streak,
    p_total_correct, p_total_questions, p_best_score, now()
  )
  on conflict (user_id, game_id) do update set
    games_played = excluded.games_played,
    wins = excluded.wins,
    current_streak = excluded.current_streak,
    best_streak = excluded.best_streak,
    total_correct = excluded.total_correct,
    total_questions = excluded.total_questions,
    best_score = excluded.best_score,
    updated_at = now()
  returning * into v_new;

  perform private.log_admin_action(
    auth.uid(), 'Correct Statistics', 'stats', v_username,
    p_reason || ' (' || v_game_name || ')', p_user_id,
    coalesce(to_jsonb(v_old)::text, 'none'), to_jsonb(v_new)::text
  );

  return v_new;
end; $$;

revoke all on function public.admin_correct_user_game_stats(uuid, text, integer, integer, integer, integer, integer, integer, integer, text) from public, anon;
grant execute on function public.admin_correct_user_game_stats(uuid, text, integer, integer, integer, integer, integer, integer, integer, text) to authenticated;
