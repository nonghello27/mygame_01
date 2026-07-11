-- 024_adventure_grid — Phase 11.2: the grid-maze session engine's schema.
--
-- Phase 11 replaces the old step-list Adventure (Phase 7.4 step B) with an
-- explorable width×height maze (Phase 11.1's generateGridMap()). The session
-- row keeps everything 7.4 already froze (seed, map, party, state, loot,
-- ends_at, pending_battle) and grows exactly the columns the grid needs on
-- top:
--   * difficulty   — which of the def's config.difficulties tier this run
--                    was started at (frozen, same spirit as seed/map/party —
--                    a later admin edit to config.difficulties must not
--                    retroactively change what an in-flight run is playing).
--   * pos_x/pos_y  — the party's current cell (replaces the old scalar
--                    `position` step-index; that column stays in place,
--                    unused by the grid engine, rather than dropped — see
--                    server/repos/adventures.js's insertSession comment).
--   * moves_total/moves_left — the run's move BUDGET (the sum of the 3 party
--                    lanes' derived spd, plus the def's movesBonus, frozen at
--                    start) and how many are left; reaching 0 anywhere but
--                    the entrance strands the run (server/services/
--                    adventure.js's move()).
--   * visited      — jsonb array of cellKey() strings ("x,y") the party has
--                    actually stood on (never a neighbor merely peeked at —
--                    a visited cell's orthogonal neighbors are derived at
--                    READ time, not stored) — the fog-of-war state a session
--                    view is built from (shared/rules/adventure.js's
--                    visibleCellKeys()).
--   * cleared      — jsonb array of cellKey() strings whose monster/item
--                    content has already been resolved — a monster/item cell
--                    stepped onto a second time (backtracking) is inert.
--
-- CAVEAT (every migration): the runner splits statements on ';' after
-- stripping full-line comments — never put a semicolon inside an inline
-- `--` comment.

ALTER TABLE adventure_sessions ADD COLUMN difficulty text;
ALTER TABLE adventure_sessions ADD COLUMN pos_x integer;
ALTER TABLE adventure_sessions ADD COLUMN pos_y integer;
ALTER TABLE adventure_sessions ADD COLUMN moves_total integer;
ALTER TABLE adventure_sessions ADD COLUMN moves_left integer;
ALTER TABLE adventure_sessions ADD COLUMN visited jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE adventure_sessions ADD COLUMN cleared jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Data migration: an in-flight 'active' session from before this migration is
-- in the OLD step-list shape (map.steps, a scalar position, no pos_x/pos_y/
-- moves_left) — there is no sensible mapping from "step 3 of 8" onto a grid
-- cell, so rather than attempt one, every such run is abandoned outright
-- (the same terminal outcome a lazy ends_at expiry already gives it — its
-- escrowed loot log is forfeited) and its party's busy lock is freed so
-- those monsters aren't stuck "on an adventure" forever.
UPDATE adventure_sessions SET state = 'abandoned' WHERE state = 'active';
UPDATE monsters SET busy_until = NULL, busy_kind = NULL WHERE busy_kind = 'adventure';
