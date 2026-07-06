-- 014_tournaments — Tournaments, schema half (Phase 9.2). Admin-created
-- INSTANCE data (not master content, like adventure_defs/summon_defs are) —
-- a tournament is a one-off scheduled event, not reusable balance data.
-- Resolution (bracket generation, round-by-round settlement, reward payout)
-- is Phase 9.3 — this migration only lands the tables every later sub-phase
-- (9.2 registration, 9.3 settlement, 9.5's GVG events reusing the same
-- schedule/reward grammar) reads and writes.
--
-- tournaments: one row per scheduled event.
--   * reg_starts_at/reg_ends_at bound the registration window
--     (server/services/adminValidate.js's validateEventSchedule — both must
--     be in the future at creation, starts < ends).
--   * seed is minted at creation (Math.floor(Math.random() * 0x7fffffff),
--     same precedent as match creation / Summon Hall pulls) and stored NOW
--     even though nothing reads it until 9.3 generates the bracket from it —
--     CLAUDE.md §1.6: a stored seed is what makes the eventual bracket
--     replayable/auditable forever.
--   * rewards is the Phase 9.1 grammar (shared/rules/rewards.js) validated by
--     validateEventRewards — positionRewards for ranks 1-3, percentileRewards
--     tiers covering everyone else.
--   * status walks scheduled -> registration -> running -> completed |
--     cancelled. This phase never advances it past 'scheduled' on its own —
--     registration is gated purely by the reg_starts_at/reg_ends_at window,
--     not by status, so a tournament is registerable the instant it's
--     'scheduled' AND inside its window (9.3's settleTournaments() is what
--     actually flips scheduled->registration->running->completed lazily).
--   * standings is NULL until 9.3's placements() resolution fills it in.
--   * The status index serves 9.3's "anything due?" lazy-settlement probe
--     (CLAUDE.md §1.5: no cron, ever) without a table scan.
--
-- tournament_entries: one row per trainer's registration.
--   * team is the frozen `{lanes, display}` snapshot — the EXACT shape
--     adventure_sessions.party freezes (toLane() + equipped gear + socketed
--     runes, in the player's chosen order) — CLAUDE.md §1.1/1.6: a
--     registered team can never change after the fact, and a later battle
--     replays from this snapshot + a stored seed alone.
--   * monster_ids is the locked id set the busy-claim took and the eventual
--     release must free — kept alongside `team` (which duplicates monsterId
--     per lane) so the busy-lock/release code never has to unpack the
--     snapshot to know what it locked.
--   * fee_paid freezes what THIS entry actually paid at registration time —
--     a later admin edit to entry_fee must never change what a refund pays
--     back, same "freeze it so a later edit can't retroactively matter"
--     reasoning as marketplace_listings' price.
--   * refunded is the idempotent-refund claim flag admin cancel's
--     "safe to re-run after a crash" guarantee rides on (a guarded
--     `UPDATE ... WHERE refunded = false` is the whole gate — see
--     server/repos/tournaments.js).
--   * UNIQUE(tournament_id, trainer_id) is the one-entry-per-trainer guard a
--     racing double-register 23505s against, same shape as
--     adventure_sessions_one_active_idx guards "one active run".
--
-- tournament_matches: one row per resolved bracket pairing — schema only in
-- this phase (9.3 is the first writer). Kept in 014 rather than a later
-- migration so tournaments have exactly one migration to read start to
-- finish. entry_a/entry_b/winner are nullable (a bye pairing has no entry_b
-- and an unresolved pairing has no winner yet). UNIQUE(tournament_id, round,
-- position) is the exactly-once-per-pairing guard 9.3's round-settlement
-- claim rides on, same shape as tournament_entries' per-trainer uniqueness.
--
-- Same CAUTION as every migration: the runner splits statements on ';'
-- after stripping full-line comments — no semicolons inside inline
-- `--` comments.

CREATE TABLE IF NOT EXISTS tournaments (
  id             BIGSERIAL   PRIMARY KEY,
  name           TEXT        NOT NULL,
  description    TEXT        NOT NULL DEFAULT '',
  reg_starts_at  TIMESTAMPTZ NOT NULL,
  reg_ends_at    TIMESTAMPTZ NOT NULL,
  seed           INT         NOT NULL,
  rewards        JSONB       NOT NULL,           -- shared/rules/rewards.js grammar
  entry_fee      INT         NOT NULL DEFAULT 0 CHECK (entry_fee >= 0),
  status         TEXT        NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'registration', 'running', 'completed', 'cancelled')),
  standings      JSONB,                          -- NULL until 9.3's placements() resolution
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tournaments_status_idx ON tournaments (status);

CREATE TABLE IF NOT EXISTS tournament_entries (
  id             BIGSERIAL   PRIMARY KEY,
  tournament_id  BIGINT      NOT NULL REFERENCES tournaments(id),
  trainer_id     BIGINT      NOT NULL REFERENCES trainers(id),
  team           JSONB       NOT NULL,           -- frozen {lanes, display} — the adventure_sessions.party shape
  monster_ids    BIGINT[]    NOT NULL,           -- the locked ids, for busy-claim/release without unpacking team
  fee_paid       INT         NOT NULL DEFAULT 0, -- entry_fee AT REGISTRATION TIME — a refund never depends on a later edit
  refunded       BOOLEAN     NOT NULL DEFAULT false, -- the idempotent-refund claim flag for cancel
  entered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, trainer_id)
);

CREATE INDEX IF NOT EXISTS tournament_entries_trainer_idx ON tournament_entries (trainer_id);

CREATE TABLE IF NOT EXISTS tournament_matches (
  id             BIGSERIAL   PRIMARY KEY,
  tournament_id  BIGINT      NOT NULL REFERENCES tournaments(id),
  round          INT         NOT NULL,
  position       INT         NOT NULL,
  entry_a        BIGINT      REFERENCES tournament_entries(id), -- NULL only for a bye pairing
  entry_b        BIGINT      REFERENCES tournament_entries(id), -- NULL only for a bye pairing
  seed           INT         NOT NULL,
  winner         BIGINT      REFERENCES tournament_entries(id), -- NULL until resolved
  result         JSONB,                          -- the resolveBattle() result, once played
  UNIQUE (tournament_id, round, position)
);

CREATE INDEX IF NOT EXISTS tournament_matches_tournament_idx ON tournament_matches (tournament_id);
