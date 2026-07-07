-- 017_gvg — GVG events: schedule, team submission, lineup (Phase 9.5). Like
-- tournaments (014), a GVG event is admin-created INSTANCE data (a one-off
-- scheduled event), not master content — no `src/data/*.js` seed file, no
-- `npm run db:seed` path, only the admin console's forthcoming GVG tab
-- (`POST/GET /api/admin/gvg`, `POST /api/admin/gvg/cancel`). Teams and
-- registrations, in turn, are player-created (guild-member/guild-leader)
-- data, the same instance-vs-master split guild_members/guild_applications
-- draw against guilds.
--
-- Re-instantiates the tournament event lifecycle at guild level: `gvg_events`
-- shares the exact schedule + rewards grammar tournaments do
-- (server/services/adminValidate.js's validateEventSchedule/
-- validateEventRewards, composed by this phase's new validateGvgEvent) plus
-- two GVG-only knobs (min/max teams per guild). Unlike tournaments, there is
-- NO entry fee here — GVG events have none by design.
--
-- gvg_wars (the per-pairing rows GVG battle resolution writes) is SCHEMA ONLY
-- in this migration — Phase 9.7 is its first writer. Kept here rather than in
-- a later migration so GVG has exactly one migration to read start to finish,
-- the same precedent 014's tournament_matches (9.3's first writer, landed in
-- 9.2's migration) sets.
--
-- gvg_events: one row per scheduled event.
--   * reg_starts_at/reg_ends_at bound the registration window — team
--     submission AND guild registration are both gated purely by this window,
--     never by status alone, same "window is the real gate" reasoning as
--     tournaments.
--   * seed is minted at creation (the 014 precedent) even though nothing
--     reads it until 9.7 generates the guild-vs-guild bracket from it —
--     CLAUDE.md §1.6: a stored seed is what makes the eventual war bracket
--     replayable/auditable forever.
--   * rewards is the same Phase 9.1 grammar tournaments.rewards uses.
--   * min_teams/max_teams bound how many teams a guild's lineup may field —
--     fixed at 1-10 per the design (a guild registers with anywhere from 1 up
--     to 10 ordered teams).
--   * status walks scheduled -> registration -> running -> completed |
--     cancelled, same convention as tournaments.status — this phase (9.5)
--     never advances it past 'registration' on its own (see
--     server/repos/gvg.js's listDueGvgEvents doc comment for exactly what IS
--     lazy here); 9.7 is what drives running -> completed.
--   * standings is NULL until 9.7 fills it in.
--   * The status index serves the lazy-settlement "anything due?" probe
--     (CLAUDE.md §1.5: no cron, ever), same as tournaments_status_idx.
--
-- gvg_teams: one row per trainer's submitted team for one event.
--   * guild_id freezes the submitter's guild AT SUBMISSION TIME — a later
--     leave/kick doesn't move an already-submitted team to a different guild
--     (or strand it with none); it simply stays where it was submitted.
--   * team is the frozen `{lanes, display}` snapshot — the EXACT
--     tournament_entries.team / adventure_sessions.party shape (toLane() +
--     equipped gear + socketed runes, in the player's chosen order).
--   * monster_ids is the locked id set the busy-claim took and the eventual
--     release must free — kept alongside `team` for the same "never unpack
--     the snapshot just to know what it locked" reasoning as
--     tournament_entries.monster_ids.
--   * battle_order is NULL until the guild's LEADER selects this team into
--     the lineup (1-based once picked) — the "submitted but not picked"
--     state a member's team sits in by default.
--   * released is the idempotent lock-release claim flag — the same role
--     tournament_entries.refunded plays for cancel: window-close settlement
--     and admin cancel both flip it false->true as their exactly-once gate
--     (there being no fee here, "released" is the whole compensation, not
--     "refunded and released").
--   * UNIQUE(event_id, trainer_id) is the one-submission-per-trainer-per-
--     event guard a racing double-submit 23505s against, same shape as
--     tournament_entries' per-trainer uniqueness.
--   * The partial UNIQUE index on (event_id, guild_id, battle_order) WHERE
--     battle_order IS NOT NULL stops two teams from landing on the same
--     lineup slot for the same guild (NULLs are exempt, so any number of
--     submitted-but-unpicked teams may coexist).
--
-- gvg_registrations: one row per guild's registration for one event.
--   * UNIQUE(event_id, guild_id) is the one-registration-per-guild-per-event
--     guard a racing double-register 23505s against.
--
-- gvg_wars: one row per resolved guild-vs-guild pairing — schema only in this
-- phase (9.7 is the first writer). guild_b is nullable (a bye pairing has no
-- opponent); winner is nullable until resolved; results is the per-battle
-- relay log 9.7 appends to as each lineup slot's battle plays out.
-- UNIQUE(event_id, round, position) is the exactly-once-per-pairing guard,
-- same shape as tournament_matches.
--
-- Same CAUTION as every migration: the runner splits statements on ';'
-- after stripping full-line comments — no semicolons inside inline
-- `--` comments.

CREATE TABLE IF NOT EXISTS gvg_events (
  id             BIGSERIAL   PRIMARY KEY,
  name           TEXT        NOT NULL,
  description    TEXT        NOT NULL DEFAULT '',
  reg_starts_at  TIMESTAMPTZ NOT NULL,
  reg_ends_at    TIMESTAMPTZ NOT NULL,
  seed           INT         NOT NULL,
  rewards        JSONB       NOT NULL,           -- shared/rules/rewards.js grammar
  min_teams      INT         NOT NULL DEFAULT 1  CHECK (min_teams >= 1 AND min_teams <= 10),
  max_teams      INT         NOT NULL DEFAULT 10 CHECK (max_teams >= 1 AND max_teams <= 10),
  status         TEXT        NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'registration', 'running', 'completed', 'cancelled')),
  standings      JSONB,                          -- NULL until 9.7's resolution fills it in
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_teams <= max_teams)
);

CREATE INDEX IF NOT EXISTS gvg_events_status_idx ON gvg_events (status);

CREATE TABLE IF NOT EXISTS gvg_teams (
  id             BIGSERIAL   PRIMARY KEY,
  event_id       BIGINT      NOT NULL REFERENCES gvg_events(id),
  guild_id       BIGINT      NOT NULL REFERENCES guilds(id),   -- frozen at submission time
  trainer_id     BIGINT      NOT NULL REFERENCES trainers(id),
  team           JSONB       NOT NULL,           -- frozen {lanes, display} — the tournament_entries.team shape
  monster_ids    BIGINT[]    NOT NULL,           -- the locked ids, for busy-claim/release without unpacking team
  battle_order   INT,                            -- NULL = submitted-but-not-picked, 1-based once selected
  released       BOOLEAN     NOT NULL DEFAULT false, -- the idempotent lock-release claim flag
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, trainer_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS gvg_teams_lineup_slot_idx
  ON gvg_teams (event_id, guild_id, battle_order) WHERE battle_order IS NOT NULL;

CREATE INDEX IF NOT EXISTS gvg_teams_event_guild_idx ON gvg_teams (event_id, guild_id);

CREATE TABLE IF NOT EXISTS gvg_registrations (
  id             BIGSERIAL   PRIMARY KEY,
  event_id       BIGINT      NOT NULL REFERENCES gvg_events(id),
  guild_id       BIGINT      NOT NULL REFERENCES guilds(id),
  registered_by  BIGINT      NOT NULL REFERENCES trainers(id),
  registered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, guild_id)
);

CREATE TABLE IF NOT EXISTS gvg_wars (
  id          BIGSERIAL   PRIMARY KEY,
  event_id    BIGINT      NOT NULL REFERENCES gvg_events(id),
  round       INT         NOT NULL,
  position    INT         NOT NULL,
  guild_a     BIGINT      REFERENCES guilds(id),
  guild_b     BIGINT      REFERENCES guilds(id),  -- nullable — a bye pairing has no opponent
  seed        INT         NOT NULL,
  winner      BIGINT      REFERENCES guilds(id),  -- NULL until 9.7 resolves this pairing
  results     JSONB,                              -- the per-battle relay log 9.7 appends
  UNIQUE (event_id, round, position)
);

CREATE INDEX IF NOT EXISTS gvg_wars_event_idx ON gvg_wars (event_id);
