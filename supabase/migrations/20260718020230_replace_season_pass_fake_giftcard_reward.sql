-- Same seed/demo issue found one level deeper while sweeping for the
-- "SAR Gift Card" pattern flagged in the weekly-challenge/tournament
-- cleanup: Season 3's pass track (the season itself is real, intended
-- content — untouched) had one node, level 10, with reward_type='reward'
-- and reward_label "500 SAR Gift Card" — the same fake real-world-money
-- prize pattern, just embedded inside an otherwise legitimate 13-node
-- reward ladder instead of being its own row.
--
-- Unlike the demo challenge/tournament (deleted entirely — they were 100%
-- placeholder rows with no real structure to preserve), deleting this
-- node would leave a gap in an otherwise sequential, already-live season
-- pass track. Replacing it in place with a real reward is the correct
-- fix here, and XP is the natural choice: it's a real, currently-working
-- reward type already used at levels 1/3/5/7/9/12 in a clean escalating
-- progression (50/100/200/300/400/‹500›/600) — level 10 sitting between
-- level 9's 400 XP and level 12's 600 XP fits exactly.
--
-- Verified zero claims on this node before changing it (no one has
-- reached level 10 and claimed the fake reward yet), so this is a pure
-- content correction with no user-facing side effects to reconcile.

update public.season_pass_nodes
set reward_type = 'xp',
    reward_ref_id = null,
    reward_amount = 500,
    reward_label = '500 XP',
    reward_label_ar = '٥٠٠ XP'
where season_id = '11111111-1111-1111-1111-111111111111'
  and level = 10
  and reward_ref_id = 'reward_season_giftcard_500';
