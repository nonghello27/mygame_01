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
  "what next?", answer from here.** Current position: Phases 0–1 complete
  (Phase 1 needs the Google OAuth env vars set to go live — see
  `.env.example`); next up is Phase 2 (owned monsters & match sessions).

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
│   ├── auth/login.js       # POST -> verify Google credential, set session cookie
│   ├── auth/logout.js      # POST -> clear session cookie
│   ├── me.js               # GET  -> trainer for the session (401 when logged out)
│   ├── rosters.js          # GET  /api/rosters  -> unit defs from Postgres
│   ├── classes.js          # GET  /api/classes  -> class metadata
│   └── battle.js           # POST /api/battle   -> resolves the fight server-side
├── server/                 # server-only logic (imported by api/, never by src/)
│   ├── auth.js             # Google token verify + HMAC session + cookie helpers
│   └── repos/trainers.js   # trainers SQL (upsert on login, get by id)
├── db/
│   ├── migrations/         # NNN_name.sql, applied in order (append-only once live)
│   ├── migrate.mjs         # npm run db:migrate (tracked in schema_migrations)
│   └── seed.mjs            # npm run db:seed (migrates, then loads master data)
├── shared/                 # PURE game logic imported by BOTH api/ and src/
│   └── engine/
│       ├── resolve.js      # the engine — runs on the server; source of truth
│       └── rng.js          # seeded PRNG (mulberry32); ALL outcome randomness
├── tests/                  # node --test; fixtures.mjs + golden/ (regen.mjs)
├── public/sprites/         # uNN.png sheets + TEMPLATE.md (art spec)
└── src/
    ├── main.js             # ENTRY: imports CSS, inits modules, wires buttons
    ├── config.js           # COLORS, accentFor(), cutscene timings
    ├── styles/             # base.css (tokens) | board.css | cutscene.css | sprite.css
    ├── data/               # static content: classes.js, sprites.js, units.js
    ├── services/           # I/O boundary: content.js, auth.js (fetch), storage.js
    ├── core/
    │   ├── units.js        # makeUnit(), cloneRoster()
    │   ├── state.js        # shared state + initContent()/resetState()
    │   └── battle.js       # client REPLAYER: requestBattle() + animate events
    ├── ui/                 # board.js, sprite.js, dragdrop.js, log.js, chroma.js, auth.js
    ├── cutscene/           # cutscene.js, portraits.js (SVG), effects.js
    └── utils/helpers.js
```

### Current data model & combat flow

A unit def: `{ name, cls, emoji, hp, atk, spd, sprite? }` + a stable `idx`
(original lane index) — the only identity the client and server exchange.
Two linking keys: **`cls`** → attack name/fx (`data/classes.js` → cutscene),
**`sprite`** → sheet in `data/sprites.js` (falls back to `emoji`).
Nothing in `core/`/`ui/` imports rosters directly — always via
`services/content.js`.

Flow: `setup` → drag to arrange → `POST /api/battle` with the two lane orders
(permutations of `idx`; server validates via `applyOrder()`) → server runs
`resolveBattle()` from DB stats → client replays `duel`/`strike`/`fall`
events (cutscenes, HP bars, lane shifts). Damage has ONE choke point:
`strike()` in `shared/engine/resolve.js`. Combat rules change ⇒ change the
engine (its golden tests will diff — regenerate via `node tests/golden/regen.mjs`
in the same commit) and usually add an event field for the replayer; never
compute outcomes client-side.

## 4. Recipes for TODAY's code

- **Add a unit:** entry in `src/data/units.js`, then `npm run db:seed` to push
  it; armies are whatever length the roster is.
- **Add sprite art:** sheet per `public/sprites/TEMPLATE.md` (96px cells,
  rows idle/attack/defend/dead ×4 frames) → `public/sprites/units/uNN.png` →
  entry in `src/data/sprites.js` → `sprite: "uNN"` on the def.
- **Add a unit class:** `data/classes.js` entry → `cutscene/portraits.js`
  case → `cutscene/effects.js` case + `.fx-<fx>` keyframes in
  `styles/cutscene.css` → use in a roster.
- **Add a stat:** def + `units` table + `SELECT`s in `api/rosters.js` /
  `api/battle.js` → card markup in `ui/board.js` → apply in `strike()`.
- **Bigger mechanics (statuses, skills, new stats):** these belong to battle
  **engine v2** — follow ARCHITECTURE §5 and the roadmap phase, don't bolt
  them onto v1.

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

- Armies fixed at 3; flat damage; no defense/crit/variance (all addressed by
  engine v2, roadmap Phase 3).
- The client still picks the **enemy** order — a strategy exploit, not
  result-tampering. Fixed by the `matches` session in roadmap **Phase 2**
  (`POST /api/match` snapshots a server-chosen defender + seed; battle
  results become persisted; replays rejected).
- Battle results aren't persisted yet, no sound, no AI opponent.
- Auth exists (Google → session cookie) but the battle endpoints don't
  require it yet; they become per-trainer in Phase 2.
