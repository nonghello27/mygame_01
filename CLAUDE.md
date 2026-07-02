# CLAUDE.md — Battle Line → the Trainer game

Project context for AI coding agents (Claude Code, Antigravity, etc.) and
humans. Read this before making changes.

## 0. Orientation — read this first

This repo is a working prototype **growing into a bigger game**. Two layers:

- **What is BUILT today:** a tactical lane-battle prototype ("Battle Line",
  §2–§4 below). Two 3-unit columns; front units duel; the player's agency is
  arranging unit order before the fight. Server-authoritative resolution,
  client replays an event log.
- **What we are BUILDING toward:** a web game where the player is a
  **Trainer** who owns, trains, and equips **monsters**, sends them to work /
  training / adventures, and battles other players' formations (PVP,
  tournaments, GVG), with summons, runes, equipment, and a marketplace.

The vision and plans live in `docs/` — treat them as part of this file:

- **[docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)** — the game: trainer, monsters,
  skills, runes, activities, and the **reference battle-flow design** (§7).
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — target directory layout,
  data model (master/instance tables), battle **engine v2** spec, API surface.
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — phased build order. **When asked
  "what next?", answer from here.** Current position: Phases 0–4 complete
  (Firebase auth; owned monsters; tamper-proof matches; battle engine v2;
  work & training economy); next up is Phase 5 (PVP ladder & trainer
  progression).

Don't build ahead of the roadmap phase you're in, and don't assume a
directory from ARCHITECTURE's *target* layout exists until it does — §3 below
is the layout that is real today.

## 1. Philosophy (non-negotiable, applies to all phases)

1. **Server-authoritative.** The client sends *choices* (orders, formations,
   job ids) — never stats, damage, rewards, or outcomes. Every handler
   validates choices against DB state (`applyOrder()` in `api/battle.js` is
   the model). Any value a handler trusts from the request body is a bug.
2. **Pure engine + event-log replay.** Battle resolution is a pure function
   — no DOM, no I/O, no wall clock — returning an ordered event list the
   client animates. The replayer never does math. Today that pair is
   `shared/engine/resolve.js` (authoritative) + `src/core/battle.js` (replayer).
3. **Master/instance data.** Baseline content in master tables; player-owned
   things are instance rows referencing a master id. Balance lives in data.
4. **Content as rows, not branches.** New skills/statuses/jobs are data
   interpreted by a small closed set of engine operations. Adding a skill
   must not add an `if` to the engine.
5. **Lazy time.** Timed activities store `ends_at` and resolve on next read.
   No cron, no websockets, until a feature proves the need.
6. **Determinism.** All randomness flows through a seeded PRNG; the seed is
   stored with the match so any result can be replayed and audited.

## 2. Tech stack

- **Vanilla JavaScript, ES modules.** No framework — intentional; keep
  dependencies minimal and the codebase approachable.
- **Vite** for dev server + build; deploys as a static site + **Vercel
  serverless functions** (`api/`, also served by Vite dev middleware).
- **Neon Postgres** via `@neondatabase/serverless` (connection in `api/_db.js`).
- **CSS + inline SVG + PNG sprite sheets** for art; motion is CSS keyframes.

Node 18+ recommended.

```bash
npm install      # once
npm run dev      # local dev server at http://localhost:5173
npm run build    # production build to dist/
npm run preview  # preview the production build
npm test         # node --test: engine golden logs + RNG (no DB needed)
npm run db:migrate  # apply pending db/migrations/ (needs .env)
npm run db:seed     # migrate + load master data from src/data/
```

## 3. Layout as it exists TODAY

(Full target layout — including `server/` — is ARCHITECTURE §3; grow into it
per roadmap phase, don't big-bang rename.)

```
├── index.html              # static shell + DOM the app mounts into
├── vite.config.js          # base:'./'; serves api/ via dev middleware
├── api/                    # serverless functions (thin: parse → auth → server/ → respond)
│   ├── _db.js              # Neon connection + sendJson()/readJson()
│   ├── auth/login.js       # POST -> verify Firebase ID token, set session cookie
│   ├── auth/logout.js      # POST -> clear session cookie
│   ├── me.js               # GET  -> trainer for the session; settles finished jobs first
│   ├── classes.js          # GET  /api/classes  -> class metadata
│   ├── activities.js       # GET farm state | POST {monsterId, jobId} start a job
│   ├── match.js            # POST -> open a match: server picks/freezes enemy + seed
│   └── battle.js           # POST {matchId, playerOrder} -> resolve once, persist
├── server/                 # server-only logic (imported by api/, never by src/)
│   ├── auth.js             # Firebase token verify + HMAC session + cookie helpers
│   ├── http.js             # httpError(status, msg), shared by services
│   ├── repos/              # SQL: trainers, species, monsters, matches, activities
│   └── services/           # matches.js (applyOrder gate), activities.js (lazy settle)
├── db/
│   ├── migrations/         # NNN_name.sql, applied in order (append-only once live)
│   ├── migrate.mjs         # npm run db:migrate (tracked in schema_migrations)
│   └── seed.mjs            # npm run db:seed (migrates, then loads master data)
├── shared/                 # PURE game logic imported by BOTH api/ and src/
│   ├── engine/
│   │   ├── resolve.js      # engine v2: readiness loop + turn pipeline; source of truth
│   │   └── rng.js          # seeded PRNG (mulberry32); ALL outcome randomness
│   └── rules/              # balance data: formulas, elements, targeting, statuses
├── tests/                  # node --test; fixtures.mjs + golden/ (regen.mjs)
├── public/sprites/         # uNN.png sheets + TEMPLATE.md (art spec)
└── src/
    ├── main.js             # ENTRY: imports CSS, inits modules, wires buttons
    ├── config.js           # COLORS, accentFor(), cutscene timings
    ├── styles/             # base.css (tokens) | board | cutscene | sprite | auth | farm
    ├── data/               # seed content: classes, sprites, units, skills, jobs
    ├── services/           # I/O boundary: content.js, auth.js, firebase.js, storage.js
    ├── core/
    │   ├── units.js        # makeUnit(), cloneRoster()
    │   ├── state.js        # shared state + initContent()/resetState()
    │   └── battle.js       # client REPLAYER: requestBattle() + animate events
    ├── ui/                 # board, sprite, dragdrop, log, chroma, auth, farm
    ├── cutscene/           # cutscene.js, portraits.js (SVG), effects.js
    └── utils/helpers.js
```

### Current data model & combat flow

Master/instance in action: `monster_species` + `species_skills` (master,
seeded from `src/data/units.js` + `skills.js`; `starter` species are granted
to new trainers on their first match) → `monsters` + `monster_skills`
(instance rows owned by a trainer; attributes and skill levels grow
per-instance). A battle lane = identity (`idx`, monsterId, speciesId) +
traits (element, attackKind, attackStyle, targeting) + DERIVED stats (maxHp,
atkMin/Max, matkMin/Max, spd, crit, evade, acc — computed once by
`deriveStats()` in the match snapshot) + `skills[]` with their JSONB data.
The stable `idx` is the only identity the client and server exchange. Two linking keys: **`cls`** → attack name/fx
(`data/classes.js` → cutscene), **`sprite`** → sheet in `data/sprites.js`
(falls back to `emoji`). Nothing in `core/`/`ui/` calls the API directly —
always via `services/content.js`.

Flow: login → `POST /api/match` (server assembles YOUR team from `monsters`,
picks + freezes the enemy team/order, mints + stores the seed in `matches`) →
drag your lanes only → `POST /api/battle {matchId, playerOrder}` (permutation
gate `applyOrder()` in `server/services/matches.js`; each match resolves
exactly once — replays get 409) → server runs `resolveBattle(A, B, seed)`
from the snapshots and persists the result → client replays the event log
(`turn`/`skill`/`strike`/`miss`/`dot`/`status`/`heal`/`buff`/`skip`/`fall`/
`draw`) — cutscenes, HP bars, lane shifts; the replayer never does math.

Engine v2 (`shared/engine/resolve.js`): readiness gauges fill by effective
SPD (threshold subtract, overflow carries) → per turn: status ticks →
control check → ultimate-if-ready else normal else basic attack → targeting
registry → damage. ALL rolls go through the seeded rng; same snapshot + seed
⇒ same log. Damage has ONE choke point: `strike()`. Skills/statuses are
JSONB rows interpreted by the closed op set (`shared/rules/`); adding content
must not add engine branches. Combat rules change ⇒ change the engine/rules
(golden tests will diff — regenerate via `node tests/golden/regen.mjs` in the
same commit) and usually add an event field for the replayer; never compute
outcomes client-side.

Economy (Phase 4): `job_defs` (master, seeded from `src/data/jobs.js`) →
`activities` (instance; `ends_at` + persisted `outcome`). Lazy time in
practice: `settleActivities()` (`server/services/activities.js`) runs on
every authenticated read (`/api/me`, `/api/activities`, match creation) and
pays out finished jobs — work → trainer gold/exp, training → +1 monster
attribute — each in ONE atomic claim+pay statement, exactly once. Busy lock:
`monsters.busy_until`/`busy_kind`, taken atomically at job start; busy
monsters are excluded from new matches and can't take a second job. The farm
panel (`src/ui/farm.js`) is pure display; "collect" is just a re-read.

## 4. Recipes for TODAY's code

- **Add a species:** entry in `src/data/units.js` (ROSTER_A = starters,
  ROSTER_B = wild pool), then `npm run db:seed` to upsert `monster_species`.
- **Add sprite art:** sheet per `public/sprites/TEMPLATE.md` (96px cells,
  rows idle/attack/defend/dead ×4 frames) → `public/sprites/units/uNN.png` →
  entry in `src/data/sprites.js` → `sprite: "uNN"` on the def.
- **Add a unit class:** `data/classes.js` entry → `cutscene/portraits.js`
  case → `cutscene/effects.js` case + `.fx-<fx>` keyframes in
  `styles/cutscene.css` → use in a roster.
- **Add a skill:** row in `src/data/skills.js` (power/target/onHit/support/
  passive grammar) → assign in a species' `skills` in `units.js` →
  `npm run db:seed`. No engine change. New status id or targeting rule ⇒ one
  entry in `shared/rules/statuses.js` / `targeting.js`.
- **Add a job:** row in `src/data/jobs.js` (work: `{gold, trainerExp}` |
  training: `{attr, gain}`) → `npm run db:seed`. No code change — settlement
  interprets rewards by kind; `tests/jobs.test.mjs` guards the grammar.
- **Add a stat:** attrs live in `monster_species`/`monsters` (new migration);
  derived stats in `shared/rules/formulas.js` `deriveStats()`; consumed via
  `toLane()` in `server/services/matches.js` → card markup in `ui/board.js`.
- **Change balance:** numbers in `shared/rules/` + `src/data/` only; golden
  tests will diff — regenerate intentionally in the same commit.

## 5. Conventions

- Keep **core logic DOM-free**; pass UI behavior in as hooks (see `runBattle`).
- One module = one responsibility; if a file does two jobs, split it.
- `api/` handlers stay thin (parse → validate → logic → respond).
- Faction colors are synced in two places: CSS vars `--a`/`--b` in
  `styles/base.css` and `COLORS` in `src/config.js`. Update both.
- Cutscene keyframes are authored against a **2.1s timeline, impact ~66%**;
  keep `CUTSCENE` timings in `config.js` in sync.
- Stable string ids (`sprite:"u01"`, class/species/skill ids) are the DB keys
  — never renumber them.
- After non-trivial changes run `npm run build` and `npm test`; engine
  changes require the golden-log tests to pass (or be intentionally
  regenerated in the same commit).
- Schema changes are NEW files in `db/migrations/` — never edit an applied
  migration.
- When a change alters an interface described in `docs/`, update the doc in
  the same change.

## 6. Known gaps (today)

- Teams fixed at 3; no DEF/mitigation stat; trainer skills don't join the
  battle yet (Phase 5); runes/equipment don't exist yet (Phase 6).
- Battle wins still award nothing (gold/exp come from work jobs only);
  monsters have no level/exp of their own — training raises attributes
  directly. Gold has nothing to buy yet (marketplace/summons are Phase 6).
- Opponents are random species teams, not other trainers' formations
  (PVP defense formations are Phase 5). No sound.
- Migration runner splits statements on `;` after stripping full-line
  comments — don't put semicolons inside inline `--` comments in migrations.
