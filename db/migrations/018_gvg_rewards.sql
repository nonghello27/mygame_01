-- 018_gvg_rewards — the idempotent per-team payout gate GVG war resolution
-- (Phase 9.7) needs on top of 017's schema: `gvg_teams.reward` plays the
-- EXACT role `tournament_entries.reward` (015) plays for
-- claimEntryReward() — NULL until settleGvg()'s payout pass stamps
-- `{rank, rewards}` in one guarded UPDATE (`reward IS NULL` is the whole
-- gate), so a re-run settlement pass after a mid-payout crash only ever
-- finishes the remainder, never double-pays or double-releases a team's
-- lock.
--
-- Rewards follow CONTRIBUTION, not membership (docs/ROADMAP.md's locked
-- design decision): a guild's placement pays every one of ITS LINEUP teams
-- (battle_order NOT NULL) in full, one reward claim per team row — never a
-- single reward on the event or the guild itself, which is why this column
-- lives on gvg_teams and not gvg_registrations/gvg_events.
--
-- Same CAUTION as every migration: the runner splits statements on ';'
-- after stripping full-line comments -- no semicolons inside inline
-- `--` comments.

ALTER TABLE gvg_teams ADD COLUMN IF NOT EXISTS reward JSONB;
