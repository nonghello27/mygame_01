-- 007_pvp — PVP ladder & trainer progression, step 1: schema only (Phase 6).
--
-- Two new master tables carry trainer-facing content: expertises (the three
-- trainer archetypes) and trainer_skill_defs (the two learnable skills each
-- trainer brings into battle, mirroring job_defs' shape). trainer_skills is
-- the INSTANCE table — the trainer's 2 learn slots, each pointing at a def
-- with its own level. formations + formation_slots let a trainer save a
-- lane order without an open match (defense formation = what PVP attackers
-- fight); seasons + rank_entries carry the ladder itself. matches grows PVP
-- fields now so the next step (matchmaking + resolve) has somewhere to put
-- them: kind distinguishes free (today's random-opponent) from pvp battles,
-- and attacker_trainer/defender_trainer freeze each side's trainer-skill
-- loadout the same way attacker_snapshot/defender_snapshot freeze lanes —
-- tamper-proof, replayable. No engine or API changes in this step.

CREATE TABLE IF NOT EXISTS expertises (
  id   TEXT PRIMARY KEY,   -- 'warrior' — stable string id, never renumber
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trainer_skill_defs (
  id            TEXT  PRIMARY KEY,   -- 'ts_war_might' — stable, never renumber
  expertise_id  TEXT  NOT NULL REFERENCES expertises(id),
  name          TEXT  NOT NULL,
  data          JSONB NOT NULL       -- { effects: [...] } — see src/data/expertises.js
);

-- A trainer learns at most 2 trainer skills, held in 2 fixed slots.
CREATE TABLE IF NOT EXISTS trainer_skills (
  trainer_id BIGINT   NOT NULL REFERENCES trainers(id),
  slot       SMALLINT NOT NULL CHECK (slot IN (0, 1)),
  skill_id   TEXT     NOT NULL REFERENCES trainer_skill_defs(id),
  level      INT      NOT NULL DEFAULT 1,
  PRIMARY KEY (trainer_id, slot)
);

-- A saved lane order the trainer isn't actively piloting. One 'defense'
-- formation per trainer for now — what a PVP attacker's opponent fights.
CREATE TABLE IF NOT EXISTS formations (
  id         BIGSERIAL PRIMARY KEY,
  trainer_id BIGINT NOT NULL REFERENCES trainers(id),
  purpose    TEXT   NOT NULL DEFAULT 'defense' CHECK (purpose IN ('attack', 'defense', 'gvg')),
  name       TEXT,
  UNIQUE (trainer_id, purpose)
);

CREATE TABLE IF NOT EXISTS formation_slots (
  formation_id BIGINT NOT NULL REFERENCES formations(id) ON DELETE CASCADE,
  position     INT    NOT NULL,
  monster_id   BIGINT NOT NULL REFERENCES monsters(id),
  PRIMARY KEY (formation_id, position),
  UNIQUE (formation_id, monster_id)
);

-- The ladder is scoped to a season; rank_entries resets when one closes.
CREATE TABLE IF NOT EXISTS seasons (
  id         BIGSERIAL   PRIMARY KEY,
  starts_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at    TIMESTAMPTZ NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed'))
);

CREATE TABLE IF NOT EXISTS rank_entries (
  season_id  BIGINT      NOT NULL REFERENCES seasons(id),
  trainer_id BIGINT      NOT NULL REFERENCES trainers(id),
  rating     INT         NOT NULL DEFAULT 1000,
  wins       INT         NOT NULL DEFAULT 0,
  losses     INT         NOT NULL DEFAULT 0,
  draws      INT         NOT NULL DEFAULT 0,
  reward     JSONB,                            -- season-end payout, once claimed
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, trainer_id)
);

-- The ladder query: top ratings within a season.
CREATE INDEX IF NOT EXISTS rank_entries_season_rating_idx
  ON rank_entries (season_id, rating DESC);

-- PVP battles reuse the matches table; 'kind' tells free from ladder fights
-- apart, and defender_id/*_trainer round out the tamper-proof snapshot with
-- who the defender is and both sides' frozen trainer-skill loadouts.
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS kind             TEXT NOT NULL DEFAULT 'free' CHECK (kind IN ('free', 'pvp')),
  ADD COLUMN IF NOT EXISTS defender_id      BIGINT REFERENCES trainers(id),
  ADD COLUMN IF NOT EXISTS attacker_trainer JSONB,
  ADD COLUMN IF NOT EXISTS defender_trainer JSONB;

-- trainers.expertise has been a free TEXT since 002_trainers; the master
-- table it anticipated now exists, so pin it down.
ALTER TABLE trainers
  ADD CONSTRAINT trainers_expertise_fkey FOREIGN KEY (expertise) REFERENCES expertises(id);
