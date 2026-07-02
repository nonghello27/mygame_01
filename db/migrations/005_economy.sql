-- 005_economy — work & training jobs (Phase 4).
--
-- job_defs is MASTER data (seeded from src/data/jobs.js); activities are the
-- INSTANCE rows — one per assignment, with the settled outcome persisted.
-- Time is lazy (CLAUDE.md §1.5): nothing runs when a job finishes. The row
-- just sits with ends_at in the past until the next authenticated read
-- settles it: rewards paid and the monster freed in one atomic statement.

CREATE TABLE IF NOT EXISTS job_defs (
  id         TEXT    PRIMARY KEY,   -- 'job_errand' — stable, never renumber
  kind       TEXT    NOT NULL CHECK (kind IN ('work', 'training')),
  name       TEXT    NOT NULL,
  duration_s INTEGER NOT NULL CHECK (duration_s > 0),
  rewards    JSONB   NOT NULL,      -- work: {gold, trainerExp} | training: {attr, gain}
  unlock     JSONB                  -- future gating (level/expertise), NULL = always open
);

CREATE TABLE IF NOT EXISTS activities (
  id         BIGSERIAL   PRIMARY KEY,
  trainer_id BIGINT      NOT NULL REFERENCES trainers(id),
  monster_id BIGINT      NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  job_id     TEXT        NOT NULL REFERENCES job_defs(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at    TIMESTAMPTZ NOT NULL,
  resolved   BOOLEAN     NOT NULL DEFAULT false,
  outcome    JSONB                  -- what was actually paid, written at settlement
);

-- The lazy-settlement scan: "this trainer's unresolved activities".
CREATE INDEX IF NOT EXISTS activities_unresolved_idx
  ON activities (trainer_id) WHERE NOT resolved;

-- The busy lock. A monster whose busy_until is in the future can't join a new
-- match or take another job; settlement clears it, so NULL/past = available.
ALTER TABLE monsters
  ADD COLUMN IF NOT EXISTS busy_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS busy_kind  TEXT;
