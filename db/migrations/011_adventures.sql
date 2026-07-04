-- 011_adventures — Adventure (Phase 7.4 step B, acquisition), foundations.
--
-- adventure_defs is MASTER data (seeded from src/data/adventures.js): a
-- route a trainer can send a party down. `config` is the whole map/loot
-- grammar shared/rules/adventure.js's generateMap()/rollLoot() read — steps,
-- choices-per-step, the node-type weight table, the wild encounter pool
-- battle nodes draw from, the loot/gather tables chest/gather nodes draw
-- from, and catchPct (see src/data/adventures.js's header for the full
-- grammar). `enabled` lets a route be retired without deleting it — same
-- retirement-flag rationale as summon_defs.enabled (010_summons.sql): the
-- audit FK below makes a referenced route undeletable via the usual
-- admin-CRUD 409-while-referenced guard anyway, so `enabled = false` is the
-- actual retirement lever content design reaches for.
--
-- adventure_sessions is the INSTANCE table — one row per trainer's run down
-- a route, exactly like `matches` freezes a battle's inputs:
--   * seed / map / party are FROZEN at start (matches-style snapshots) — map
--     is shared/rules/adventure.js's generateMap() output, party is the
--     snapshot of the monsters sent (mirrors toLane()'s battle snapshot
--     shape so a later battle node can reuse it directly), seed is what both
--     generateMap() and every node's rolls (deriveNodeSeed) were given, so
--     the whole run is auditable/replayable (CLAUDE.md §1.6) from this one
--     row.
--   * `state` walks active -> completed | failed | abandoned. Only one
--     'active' session per trainer at a time (enforced below) — a party
--     can't run two routes at once, same shape as "at most one active
--     season" (008_pvp_guards.sql).
--   * `position` is the step index into `map.steps` the party has reached.
--   * `ends_at` is the lazy-time safety valve, mirroring the party's
--     monsters.busy_until: an active session past ends_at is lazily marked
--     abandoned on next read (Phase 7.4 step B's service does that, same
--     read-then-claim shape as season rollover in server/services/pvp.js
--     ensureSeason) rather than a cron job or websocket ever touching it.
--   * `loot` is the running log of everything granted so far (items,
--     catches), appended to as the run progresses, so an in-progress or
--     finished session can show an end-of-run summary without re-deriving
--     it from node rolls.
--
-- No `matches` row for a battle node's fight: step B's session service
-- (server/services/adventure.js) calls resolveBattle() directly, seeded from
-- deriveNodeSeed(session.seed, position), and settles the result inline —
-- there is no match-creation path involved, on purpose (an adventure battle
-- has no opposing trainer to notify, and its outcome only ever needs to
-- update this ONE session row). Same CAUTION as every migration: the runner
-- splits statements on ';' after stripping full-line comments — no
-- semicolons inside inline `--` comments.

CREATE TABLE IF NOT EXISTS adventure_defs (
  id          TEXT    PRIMARY KEY,        -- 'ad_verdant_trail' — stable, never renumber
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  config      JSONB   NOT NULL,           -- see src/data/adventures.js header for the grammar
  enabled     BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS adventure_sessions (
  id           BIGSERIAL   PRIMARY KEY,
  trainer_id   BIGINT      NOT NULL REFERENCES trainers(id),
  adventure_id TEXT        NOT NULL REFERENCES adventure_defs(id),
  seed         BIGINT      NOT NULL,
  map          JSONB       NOT NULL,           -- generateMap(config, seed) output, frozen
  party        JSONB       NOT NULL,           -- frozen snapshot of the monsters sent
  position     INT         NOT NULL DEFAULT 0, -- index into map.steps reached so far
  state        TEXT        NOT NULL DEFAULT 'active'
                 CHECK (state IN ('active', 'completed', 'failed', 'abandoned')),
  loot         JSONB       NOT NULL DEFAULT '[]', -- running log of grants for the run summary
  ends_at      TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one 'active' session per trainer — same partial-unique-index
-- precedent as seasons_one_active_idx (008_pvp_guards.sql), guarding the
-- lazy read-then-claim shape a concurrent "start a run" request could race.
CREATE UNIQUE INDEX IF NOT EXISTS adventure_sessions_one_active_idx
  ON adventure_sessions (trainer_id) WHERE state = 'active';

CREATE INDEX IF NOT EXISTS adventure_sessions_trainer_idx ON adventure_sessions (trainer_id);
