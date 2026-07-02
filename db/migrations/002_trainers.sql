-- 002_trainers — player accounts (roadmap Phase 1).
-- A trainer is auto-created on first login, keyed by the identity provider's
-- stable subject id, never by email (emails can change/be reused). exp/gold
-- and expertise are owned by later phases but cheap to carry from day one;
-- expertise stays a free TEXT until the expertises master table exists
-- (Phase 5), when a later migration adds the FK.

CREATE TABLE IF NOT EXISTS trainers (
  id            BIGSERIAL PRIMARY KEY,
  auth_provider TEXT        NOT NULL,               -- 'google' (more later)
  auth_subject  TEXT        NOT NULL,               -- provider's stable user id
  name          TEXT        NOT NULL,
  email         TEXT,
  exp           BIGINT      NOT NULL DEFAULT 0,
  gold          BIGINT      NOT NULL DEFAULT 0,
  expertise     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (auth_provider, auth_subject)
);
