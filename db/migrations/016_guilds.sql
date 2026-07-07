-- 016_guilds — Guilds: creation, membership, roles (Phase 9.4). Guilds are
-- player-created INSTANCE data, not admin master data (like tournaments,
-- not like adventure_defs/summon_defs) — a guild is a one-off thing a
-- trainer founds, not reusable balance content, so there's no `src/data/*.js`
-- seed file and no admin console tab; the only "admin" surface is the
-- ordinary player-facing create/apply/accept flow in server/services/guild.js.
--
-- Application flow, not invites (the user-described flow this phase builds):
-- a guildless trainer applies to a guild with an optional message; the
-- guild's LEADER (only — role is always re-read from the DB at the top of
-- every write, never trusted from the request body, CLAUDE.md §1.1) accepts
-- or rejects. There is no status column on guild_applications — a pending
-- application IS a row's existence; accept/reject both just DELETE it (accept
-- also inserts the membership row first), so "answered" applications are
-- simply gone rather than kept around in a resolved state. Keeping this
-- thin, as directed, is a deliberate scope cut from a fuller invite/apply
-- system a later phase could add.
--
-- guilds: one row per founded guild.
--   * name is case-insensitively unique (guilds_name_idx below) — a guild
--     named "Titans" blocks "titans" too, same spirit as trainers' unique
--     auth identity, checked at creation time by the INSERT's own unique-
--     violation (23505), never pre-read-then-trust.
--   * leader_id denormalizes who currently leads (also reflected in
--     guild_members.role='leader' for that same trainer) — kept in sync by
--     leadership transfer (server/repos/guilds.js claimTransferLeadership),
--     which flips both in one guarded sequence.
--
-- guild_members: one row per (guild, trainer) membership.
--   * UNIQUE(trainer_id) is THE invariant every join path (create, accept)
--     23505s against — one guild per trainer, enforced at the DB layer, not
--     just pre-checked in the service (a race between two accepted
--     applications, or a create racing an accept, can't produce two rows for
--     the same trainer).
--   * role is a closed three-value set; the 'leader' role is never touched
--     by leave/kick/promote (their guarded UPDATE/DELETE statements all
--     exclude `role = 'leader'` in the WHERE, server/repos/guilds.js) — a
--     leader is removed/demoted ONLY as the losing half of a leadership
--     transfer, never directly.
--
-- guild_applications: one row per pending (guild, trainer) application.
--   * UNIQUE(guild_id, trainer_id) blocks a duplicate pending application to
--     the SAME guild (a race on "apply twice" 23505s); applying to several
--     DIFFERENT guilds at once is allowed (a trainer accepted into one guild
--     has every other pending application cleaned up in that same accept,
--     server/services/guild.js).
--
-- Same CAUTION as every migration: the runner splits statements on ';'
-- after stripping full-line comments — no semicolons inside inline
-- `--` comments.

CREATE TABLE IF NOT EXISTS guilds (
  id           BIGSERIAL   PRIMARY KEY,
  name         TEXT        NOT NULL,
  description  TEXT        NOT NULL DEFAULT '',
  emblem       TEXT        NOT NULL DEFAULT '🏰',
  leader_id    BIGINT      NOT NULL REFERENCES trainers(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS guilds_name_idx ON guilds (lower(name));

CREATE TABLE IF NOT EXISTS guild_members (
  id          BIGSERIAL   PRIMARY KEY,
  guild_id    BIGINT      NOT NULL REFERENCES guilds(id),
  trainer_id  BIGINT      NOT NULL REFERENCES trainers(id) UNIQUE,
  role        TEXT        NOT NULL CHECK (role IN ('leader', 'officer', 'member')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guild_members_guild_idx ON guild_members (guild_id);

CREATE TABLE IF NOT EXISTS guild_applications (
  id          BIGSERIAL   PRIMARY KEY,
  guild_id    BIGINT      NOT NULL REFERENCES guilds(id),
  trainer_id  BIGINT      NOT NULL REFERENCES trainers(id),
  message     TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, trainer_id)
);
