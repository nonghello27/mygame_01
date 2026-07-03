-- 008_pvp_guards — PVP ladder & matchmaking, step 4: one DB invariant.
--
-- The lazy season rollover (server/services/pvp.js ensureSeason) reads "is
-- there an active season?" and, if not, inserts one — the same read-then-act
-- shape as every other lazy-time path in this codebase. Two concurrent
-- requests can both see no active season and both try to insert one; this
-- partial unique index makes "at most one active season" a constraint the
-- database enforces, so the loser gets a unique-violation the repo turns
-- into a clean re-read instead of two active seasons ever existing at once.

CREATE UNIQUE INDEX IF NOT EXISTS seasons_one_active_idx ON seasons ((true)) WHERE status = 'active';
