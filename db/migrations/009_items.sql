-- 009_items — item/equipment/rune schema + inventory, step 1: schema only
-- (Phase 7.1, "acquisition & itemization"). Same master/instance split as
-- everything before it: item_defs/equipment_defs/rune_defs are MASTER rows
-- (stable TEXT ids, seeded from src/data/items.js, equipment.js, runes.js);
-- items/trainer_equipment/monster_equipment/runes are INSTANCE rows a
-- trainer owns, each carrying trainer_id + a FK back to its def.
--
-- item_defs covers stackable, slot-less stuff: materials (consumed by later
-- phases — enhancement in 7.2, summoning in 7.4) and consumables. items is
-- the trainer's stack per def (UNIQUE(trainer_id, def_id), qty >= 0) —
-- grant/consume are quantity deltas on that one row, never new rows.
--
-- equipment_defs covers gear a trainer equips onto themselves (domain
-- 'trainer', slots head/body/charm) or onto a monster (domain 'monster',
-- slots weapon/armor/accessory). `effects` reuses the EXACT battle_start
-- perm_stat grammar skill passives already use (shared/engine/resolve.js
-- applyEffect()) — no new engine branches — but unlike a skill passive, an
-- equipment/rune effect may declare `perLevel` so 7.2's enhancement system
-- has something to scale; `enhance` is the optional cost curve for that
-- (NULL = this piece can't be enhanced). Each equipped instance
-- (trainer_equipment / monster_equipment) carries its own enhance_level and
-- an equipped_slot/monster_id that is NULL while the piece sits in the bag.
--
-- rune_defs are the socketed side (targeting-override ops arrive in 7.3;
-- for now, same perm_stat effect grammar as equipment). A rune instance
-- tracks its own level, remaining charges (seeded from the def's
-- max_charges), and whether it's broken (out of charges — 7.3's repair flow
-- spends repair_gold to un-break it); monster_id NULL = in the bag.
--
-- monster_species.rune_slots is the one column ARCHITECTURE's draft schema
-- already anticipated but no migration ever added — 7.3 (socketing) depends
-- on it, so it lands here even though nothing reads it yet.
--
-- No engine or battle-flow changes in this step: nothing here is fed into a
-- match snapshot or read by resolve.js yet. That wiring is later 7.x work.
-- Same CAUTION as every migration: the runner splits statements on ';'
-- after stripping full-line comments — no semicolons inside inline
-- `--` comments.

CREATE TABLE IF NOT EXISTS item_defs (
  id          TEXT PRIMARY KEY,   -- 'it_potion_small' — stable, never renumber
  kind        TEXT NOT NULL CHECK (kind IN ('material', 'consumable')),
  name        TEXT NOT NULL,
  description TEXT
);

-- slot: monster domain uses weapon/armor/accessory, trainer domain uses
-- head/body/charm. effects: [{ when:'battle_start', op:'perm_stat', stat,
-- pct?/flat?, perLevel? }]. enhance: { maxLevel, goldPerLevel } cost curve,
-- NULL means this piece can't be enhanced.
CREATE TABLE IF NOT EXISTS equipment_defs (
  id          TEXT  PRIMARY KEY,   -- 'eq_iron_sword' — stable, never renumber
  domain      TEXT  NOT NULL CHECK (domain IN ('trainer', 'monster')),
  slot        TEXT  NOT NULL,
  name        TEXT  NOT NULL,
  description TEXT,
  effects     JSONB NOT NULL,
  enhance     JSONB
);

CREATE TABLE IF NOT EXISTS rune_defs (
  id           TEXT  PRIMARY KEY,  -- 'rn_swift' — stable, never renumber
  name         TEXT  NOT NULL,
  description  TEXT,
  effects      JSONB NOT NULL,     -- same perm_stat grammar as equipment_defs.effects
  max_charges  INT   NOT NULL CHECK (max_charges > 0),
  repair_gold  INT   NOT NULL DEFAULT 0
);

-- A trainer's material/consumable stacks — one row per (trainer, def), qty
-- is the whole state. Grant/consume are UPDATE qty = qty +/- $n, never inserts
-- of new rows once the stack exists.
CREATE TABLE IF NOT EXISTS items (
  id         BIGSERIAL PRIMARY KEY,
  trainer_id BIGINT NOT NULL REFERENCES trainers(id),
  def_id     TEXT   NOT NULL REFERENCES item_defs(id),
  qty        INT    NOT NULL DEFAULT 0 CHECK (qty >= 0),
  UNIQUE (trainer_id, def_id)
);

CREATE INDEX IF NOT EXISTS items_trainer_idx ON items (trainer_id);

-- Equipment a trainer owns for themselves. equipped_slot NULL = in the bag;
-- non-null names which of the domain's slots it currently fills.
CREATE TABLE IF NOT EXISTS trainer_equipment (
  id             BIGSERIAL PRIMARY KEY,
  trainer_id     BIGINT NOT NULL REFERENCES trainers(id),
  def_id         TEXT   NOT NULL REFERENCES equipment_defs(id),
  enhance_level  INT    NOT NULL DEFAULT 0,
  equipped_slot  TEXT
);

CREATE INDEX IF NOT EXISTS trainer_equipment_trainer_idx ON trainer_equipment (trainer_id);

-- Equipment a trainer owns for a monster. monster_id NULL = in the bag;
-- non-null means it's equipped onto that monster (in that def's slot).
CREATE TABLE IF NOT EXISTS monster_equipment (
  id             BIGSERIAL PRIMARY KEY,
  trainer_id     BIGINT NOT NULL REFERENCES trainers(id),
  def_id         TEXT   NOT NULL REFERENCES equipment_defs(id),
  enhance_level  INT    NOT NULL DEFAULT 0,
  monster_id     BIGINT REFERENCES monsters(id)
);

CREATE INDEX IF NOT EXISTS monster_equipment_trainer_idx ON monster_equipment (trainer_id);
CREATE INDEX IF NOT EXISTS monster_equipment_monster_idx ON monster_equipment (monster_id)
  WHERE monster_id IS NOT NULL;

-- Runes a trainer owns. monster_id NULL = in the bag; charges_left is seeded
-- from the def's max_charges on grant and drains as 7.3 spends them.
CREATE TABLE IF NOT EXISTS runes (
  id            BIGSERIAL PRIMARY KEY,
  trainer_id    BIGINT NOT NULL REFERENCES trainers(id),
  def_id        TEXT   NOT NULL REFERENCES rune_defs(id),
  level         INT    NOT NULL DEFAULT 1,
  charges_left  INT    NOT NULL,
  broken        BOOLEAN NOT NULL DEFAULT false,
  monster_id    BIGINT REFERENCES monsters(id)
);

CREATE INDEX IF NOT EXISTS runes_trainer_idx ON runes (trainer_id);
CREATE INDEX IF NOT EXISTS runes_monster_idx ON runes (monster_id)
  WHERE monster_id IS NOT NULL;

-- Anticipated by ARCHITECTURE's draft schema but never migrated until a
-- feature (7.3 socketing) actually needed it.
ALTER TABLE monster_species
  ADD COLUMN IF NOT EXISTS rune_slots INT NOT NULL DEFAULT 1;
