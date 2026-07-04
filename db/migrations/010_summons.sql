-- 010_summons — Summon Hall (Phase 7.4 step A, acquisition).
--
-- summon_defs is MASTER data (seeded from src/data/summons.js): a banner a
-- trainer can pull from, paying `cost` (a pluggable list of requirement
-- objects — gold and/or item stacks today; the SAME registry shape
-- server/services/summon.js's REQUIREMENT_CHECKERS reads, so a later
-- requirement kind is one new registry entry, never a branch there or here)
-- for one weighted-random monster drawn from `pool` (a list of
-- {speciesId, weight}). `enabled` lets a banner be retired without deleting
-- it — the audit FK below makes a referenced banner undeletable via the
-- usual admin-CRUD 409-while-referenced guard anyway, so `enabled = false`
-- is the actual retirement lever content design reaches for.
--
-- summons is the AUDIT trail — one row per pull: which trainer, which
-- banner, and the resulting monster, exactly like `matches` freezes a
-- battle's inputs. `cost`/`pool` are SNAPSHOTS of the def as it was at pull
-- time (not a live join back to summon_defs), so a later admin edit to the
-- banner can never retroactively change what an old audit row says was
-- charged/offered — same "freeze what mattered" philosophy as
-- matches.attacker_snapshot. `seed` is the RNG seed rollSummon()
-- (shared/rules/summon.js) was given, so any pull is auditable/replayable
-- (CLAUDE.md §1.6), even though nothing here feeds a battle snapshot.
--
-- No engine or battle-flow changes in this step: summoning never touches
-- resolve.js. Same CAUTION as every migration: the runner splits statements
-- on ';' after stripping full-line comments — no semicolons inside inline
-- `--` comments.

CREATE TABLE IF NOT EXISTS summon_defs (
  id          TEXT    PRIMARY KEY,        -- 'sm_novice' — stable, never renumber
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  cost        JSONB   NOT NULL,           -- [{type:'gold',amount} | {type:'item',itemId,qty}]
  pool        JSONB   NOT NULL,           -- [{speciesId, weight}]
  enabled     BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS summons (
  id                BIGSERIAL   PRIMARY KEY,
  trainer_id        BIGINT      NOT NULL REFERENCES trainers(id),
  summon_id         TEXT        NOT NULL REFERENCES summon_defs(id),
  cost              JSONB       NOT NULL, -- snapshot of summon_defs.cost at pull time
  pool              JSONB       NOT NULL, -- snapshot of summon_defs.pool at pull time
  seed              BIGINT      NOT NULL,
  result_species_id TEXT        NOT NULL,
  monster_id        BIGINT      NOT NULL REFERENCES monsters(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS summons_trainer_idx ON summons (trainer_id);
