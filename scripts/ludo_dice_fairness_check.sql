-- Ludo dice fairness diagnostic.
--
-- Rolls the EXACT formula used server-side in public.ludo_submit_move
-- ( floor(random() * 6)::int + 1 ) 100,000 times and reports the count and
-- percentage of each face 1-6. Run this directly in the Supabase SQL
-- editor (or `psql ... -f scripts/ludo_dice_fairness_check.sql`) any time
-- you want to re-verify the die is mathematically fair.
--
-- Expected: each face at ~16.67%, no face at 0%, no off-by-one (no face
-- outside 1-6, no face silently unreachable).

with rolls as (
  select (floor(random() * 6)::int + 1) as face
  from generate_series(1, 100000)
)
select
  face,
  count(*) as roll_count,
  round(100.0 * count(*) / (select count(*) from rolls), 3) as pct
from rolls
group by face
order by face;

-- Sanity checks that should both return zero rows:
-- 1. Any face outside the legal 1-6 range (would indicate an off-by-one).
with rolls as (
  select (floor(random() * 6)::int + 1) as face
  from generate_series(1, 100000)
)
select * from rolls where face < 1 or face > 6;

-- 2. All six faces must actually appear (a real off-by-one, e.g. an
--    accidental `random() * 5`, would make one face permanently unreachable).
with rolls as (
  select (floor(random() * 6)::int + 1) as face
  from generate_series(1, 100000)
)
select generate_series(1, 6) as expected_face
except
select distinct face from rolls;
