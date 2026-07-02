-- 003_monsters_matches — owned monsters + tamper-proof match sessions (Phase 2).
--
-- monster_species is MASTER data (seeded from src/data/units.js; the old
-- army-A units become starter species). monsters are INSTANCES owned by a
-- trainer, stats copied from the species at creation and mutated by later
-- phases (training). matches freeze everything a battle needs the moment it
-- is created — server-chosen defender, RNG seed, attacker stats — so the
-- resolve step can trust nothing but the session cookie and a lane order.

CREATE TABLE IF NOT EXISTS monster_species (
  id      TEXT PRIMARY KEY,             -- 'sp_garran' — stable string id, never renumber
  name    TEXT    NOT NULL,
  cls     TEXT    NOT NULL REFERENCES classes(cls),
  emoji   TEXT    NOT NULL,
  hp      INTEGER NOT NULL,
  atk     INTEGER NOT NULL,
  spd     INTEGER NOT NULL,
  sprite  TEXT,
  starter BOOLEAN NOT NULL DEFAULT false  -- granted to brand-new trainers
);

CREATE TABLE IF NOT EXISTS monsters (
  id         BIGSERIAL PRIMARY KEY,
  trainer_id BIGINT NOT NULL REFERENCES trainers(id),
  species_id TEXT   NOT NULL REFERENCES monster_species(id),
  nickname   TEXT,                      -- NULL -> display the species name
  hp         INTEGER NOT NULL,          -- current grown stats (copied from species at birth)
  atk        INTEGER NOT NULL,
  spd        INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monsters_trainer_idx ON monsters (trainer_id);

CREATE TABLE IF NOT EXISTS matches (
  id                TEXT PRIMARY KEY,   -- UUID minted by the server
  attacker_id       BIGINT NOT NULL REFERENCES trainers(id),
  seed              BIGINT NOT NULL,    -- stored for auditable replays (engine v2 consumes it)
  attacker_snapshot JSONB  NOT NULL,    -- [{idx,monsterId,name,cls,emoji,sprite,hp,atk,spd}]
  defender_snapshot JSONB  NOT NULL,    -- same shape, order = the server-fixed lane order
  status            TEXT   NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  result            JSONB,              -- {youWin,survivor,events} once resolved
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS matches_attacker_idx ON matches (attacker_id, status);

-- The units table (fixed armies A/B) is fully superseded by monster_species +
-- per-trainer monsters; its seed data lives on in src/data/units.js.
DROP TABLE IF EXISTS units;
