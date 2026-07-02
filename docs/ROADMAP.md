# Roadmap — what to build, in what order, and why that order

Phases are sequenced so every phase ships something playable and nothing has
to be rebuilt later. Each phase lists **Start here** (the first concrete task
to hand an agent) and **Done when** (the acceptance test). Don't start a
phase before the previous one's "Done when" holds — the ordering encodes real
dependencies (you can't own monsters without accounts; you can't reward PVP
without an economy).

## Phase 0 — Foundations ✅ DONE (2026-07-02)

Locked in the practices everything else relies on.

- ✅ `db/schema.sql` → `db/migrations/001_init.sql` + `db/migrate.mjs` runner
  (tracked in a `schema_migrations` table; `npm run db:migrate`;
  `seed.mjs` migrates first, then seeds).
- ✅ `shared/engine/resolve.js` (moved from `src/core/`; `api/battle.js`
  updated) — the client/server-shared zone is now explicit.
- ✅ `npm test` (`node --test`): golden-log tests in `tests/resolve.test.mjs`
  against `tests/golden/*.json` (fixtures in `tests/fixtures.mjs`,
  regenerate intentionally via `node tests/golden/regen.mjs`).
- ✅ Seeded PRNG `shared/engine/rng.js` (mulberry32 + int/chance/pick),
  tested incl. a golden sequence — ready for engine v2 and match seeds.

## Phase 1 — Accounts & trainers ✅ CODE COMPLETE (2026-07-02)

- ✅ **Firebase Auth** (Google popup + email/password with register &
  password reset; more providers = console toggle) →
  `POST /api/auth/login` verifies the Firebase ID token server-side (RS256
  vs Google certs, ARCHITECTURE §7) → upsert `trainers` (`002_trainers.sql`,
  applied; keyed by Firebase uid) → HttpOnly HMAC session cookie
  (`server/auth.js`; `trainer_id` is only ever read from the session).
- ✅ `GET /api/me`, `POST /api/auth/logout`; full landing/login screen —
  the game stays hidden until the session is confirmed — plus the header
  profile bar (name/gold/exp) (`src/ui/auth.js`).
- ✅ `server/` established: `server/auth.js`, `server/repos/trainers.js`;
  session tests in `tests/auth-session.test.mjs`.

**Remaining (operator step):** in Firebase console enable the **Google**
sign-in method and add the Vercel domain under Authorized domains; set
`FIREBASE_PROJECT_ID` + `SESSION_SECRET` (+ `DATABASE_URL`) in Vercel env
vars (already in local `.env`); then verify two Google accounts see two
different trainers.

## Phase 2 — Owned monsters & tamper-proof matches ✅ DONE (2026-07-02)

Turned "two hardcoded armies" into "your monsters vs a server-picked enemy".

- ✅ `003_monsters_matches.sql`: `monster_species` (master, seeded from the
  old roster data; army A = starter species), `monsters` (instances),
  `matches` (seed + frozen attacker/defender snapshots + persisted result);
  the obsolete `units` table dropped.
- ✅ Starter monsters granted lazily on a trainer's first match.
- ✅ `POST /api/match` (auth required; server picks + freezes the enemy team
  AND its lane order, mints the seed) and `POST /api/battle
  { matchId, playerOrder }` (permutation-validated, resolves exactly once,
  result persisted, replays rejected 409). `api/rosters.js` retired.
- ✅ Client: your army comes from your monsters; the enemy side is
  drag-locked; "New Opponent" opens a fresh match; battles require login.
- Deferred by design: `formations`/`formation_slots` tables and a dedicated
  collection screen belong to Phase 5 (defense formations for PVP), where
  they're first needed — the board itself is the formation editor until then.

**Done when (verified):** a logged-in player fights their own monsters vs a
server-chosen enemy; illegal orders and replayed matchIds are rejected;
results are rows in `matches`.

## Phase 3 — Battle engine v2 (the heart; biggest phase)

Implement ARCHITECTURE §5 in `shared/engine/`, test-first.

1. Readiness loop + seeded RNG, melee-only flat damage — must reproduce
   v1 outcomes (golden tests) before anything new.
2. Attributes (STR/AGI/VIT/INT/DEX → derived stats), ATK min–max rolls,
   elements chart, melee/range + targeting registry + front-line penalty.
3. Effect system (triggers/ops/targets from JSONB) + statuses
   (stun, freeze, burn, poison, curse).
4. Skills: master `skills` table, 4 slots, cooldowns, ultimates.
5. Client replayer + cutscenes extended for the new event types
   (skill cast, status applied/ticked, skip, multi-target).

**Start here:** engine skeleton + the v1-parity golden test.
**Done when:** a scripted fixture battle with skills/statuses produces a
stable golden log, and the client replays it watchably.

## Phase 4 — Economy: work & training

The first out-of-battle loop; introduces gold as a real currency.

- `job_defs` + `activities` migrations; lazy resolution in `GET /api/me`
  (ARCHITECTURE §6); `busy_until` locking (busy monsters can't fight/train).
- Work jobs pay trainer gold + exp; training jobs raise monster attributes
  (small pools first — balance later).
- Farm/HQ screen: assign, see countdowns, collect.

**Done when:** send a monster to work, come back after the duration, gold is
there, and the monster was unusable meanwhile.

## Phase 5 — PVP ladder & trainer progression

- Defense formations; matchmaking by rank bracket against **stored** defense
  teams (async — defender offline); rating points; `seasons` +
  `rank_entries` with lazy season rollover and rewards.
- Trainer expertise + trainer skills (2 slots), feeding the engine's
  `battle_start`/`after_ally_turns` triggers — the engine already supports
  them; this phase is tables + UI + validation (switching expertise wipes
  learned skills).

**Done when:** two real accounts can attack each other's defense teams and
climb a visible ladder.

## Phase 6 — Acquisition & itemization

Order within this phase is flexible:

- **Summon Hall** (gold/item-condition summons first; pluggable-scorer quest
  hooks, but NOT the photo quest yet).
- **Runes** (charges, breakage, repair) and **equipment** (+enhance) — mostly
  master data + instance tables; the engine consumes them as effect sources.
- **Adventure** (map session in DB, POST-per-step, catches/materials).
- **Marketplace** (escrowed gold transfers; needs SQL transactions — the one
  place to be extra careful).

## Phase 7 — Social & events (later)

Guilds + GVG, tournaments (server-resolved brackets), messages/notifications,
and — last, once there's an audience and moderation plan — the **photo quest**
(image-scored summon quest, GAME_DESIGN §6.5 ⚠).

## Standing rules while executing

- Every phase updates docs/ + CLAUDE.md if it changes an interface.
- Engine changes always come with golden-log tests.
- Never widen an API to accept a value the server could look up itself.
