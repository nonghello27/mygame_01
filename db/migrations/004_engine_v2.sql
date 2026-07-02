-- 004_engine_v2 — attributes, elements, and data-driven skills (Phase 3).
--
-- Species gain the traits engine v2 consumes (element, melee/range + pattern,
-- phys/mag style) and the STR/AGI/VIT/INT/DEX baseline; monsters carry their
-- own copy of the attributes (training grows them in Phase 4). Skills are
-- master rows interpreted by the engine's closed op set; species_skills is
-- the loadout a species is born with, monster_skills the instance copy
-- (per-monster levels).
--
-- PROTOTYPE RESET: existing monsters/matches predate attributes and skills,
-- so they are cleared; starters are re-granted (with full v2 data) on each
-- trainer's next match. Fine now — no live players — never acceptable later.

DELETE FROM matches;
DELETE FROM monsters;

ALTER TABLE monster_species
  ADD COLUMN IF NOT EXISTS element      TEXT    NOT NULL DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS attack_kind  TEXT    NOT NULL DEFAULT 'melee',
  ADD COLUMN IF NOT EXISTS attack_style TEXT    NOT NULL DEFAULT 'phys',
  ADD COLUMN IF NOT EXISTS targeting    TEXT    NOT NULL DEFAULT 'front',
  ADD COLUMN IF NOT EXISTS str INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agi INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vit INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intl INTEGER NOT NULL DEFAULT 0,   -- INT (reserved word)
  ADD COLUMN IF NOT EXISTS dex INTEGER NOT NULL DEFAULT 0;

ALTER TABLE monsters
  ADD COLUMN IF NOT EXISTS str INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agi INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vit INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intl INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dex INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS skills (
  id       TEXT    PRIMARY KEY,          -- 'sk_power_strike' — stable, never renumber
  name     TEXT    NOT NULL,
  slot     TEXT    NOT NULL CHECK (slot IN ('passive', 'normal', 'ultimate')),
  cooldown INTEGER NOT NULL DEFAULT 0,
  data     JSONB   NOT NULL              -- power/target/onHit/support/passive grammar
);

-- Loadout a species is born with. slot: 0 passive1, 1 passive2, 2 normal, 3 ultimate.
CREATE TABLE IF NOT EXISTS species_skills (
  species_id TEXT     NOT NULL REFERENCES monster_species(id),
  slot       SMALLINT NOT NULL CHECK (slot BETWEEN 0 AND 3),
  skill_id   TEXT     NOT NULL REFERENCES skills(id),
  PRIMARY KEY (species_id, slot)
);

-- Instance copy per owned monster; levels grow per-monster later.
CREATE TABLE IF NOT EXISTS monster_skills (
  monster_id BIGINT   NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  slot       SMALLINT NOT NULL CHECK (slot BETWEEN 0 AND 3),
  skill_id   TEXT     NOT NULL REFERENCES skills(id),
  level      INTEGER  NOT NULL DEFAULT 1,
  PRIMARY KEY (monster_id, slot)
);
