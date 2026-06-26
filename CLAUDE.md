# CLAUDE.md — Battle Line

Project context for AI coding agents (Claude Code, Antigravity, etc.) and humans.
Read this before making changes.

## 1. Concept

**Battle Line** is a tactical lane-battle game. Each side fields a small column
of units (currently 3). The two **front** units duel; when one falls, the
survivor — keeping its remaining HP — advances to fight the next enemy unit.
The battle is fully auto-resolved; the player's agency is in **arranging unit
order before the fight** (drag to swap), which controls the matchups.

Combat is deterministic: damage is flat `atk`, higher `spd` strikes first in a
duel (ties favor the player). The whole battle is **resolved on the server**
(`/api/battle`) from authoritative DB stats; the client sends only its chosen
lane order and **replays** the returned event log — it never computes the
outcome, so a tampered client cannot fake or modify the result. When
**Cinematic** mode is on, each strike plays a Super-Robot-Wars-style full-screen
cutscene (letterbox bands, dueling portraits, a class-specific attack effect,
impact flash + damage).

The game is a prototype meant to grow: planned additions include status
effects, skills, more unit classes, and richer (possibly sprite-based) art.

## 2. Tech stack

- **Vanilla JavaScript, ES modules.** No framework. This is intentional —
  keep dependencies minimal and the codebase approachable.
- **Vite** for dev server + build.
- **CSS + inline SVG** for all art and animation (no GIF/video/Lottie/sprite
  assets yet). Motion is CSS `@keyframes`/transitions; the browser GPU-composites it.
- Deploys as a **static site** (Vite `build` → `dist/`), e.g. to Vercel.

Node 18+ recommended.

```bash
npm install      # once
npm run dev      # local dev server at http://localhost:5173
npm run build    # production build to dist/
npm run preview  # preview the production build
```

## 3. Architecture

Strict separation of concerns. Data describes the game, core runs the rules,
ui renders the board, cutscene handles the attack animation, and main wires it
together. The battle engine never touches page chrome directly — it receives
hooks.

```
battle-line/
├── index.html              # static shell + DOM the app mounts into
├── vite.config.js          # base:'./'; also serves api/ via dev middleware
├── vercel.json             # Vite static deploy config
├── api/                    # SERVERLESS functions (Vercel prod / Vite dev middleware)
│   ├── _db.js              # Neon connection + sendJson()/readJson() helpers
│   ├── rosters.js          # GET  /api/rosters  -> unit defs from Postgres
│   ├── classes.js          # GET  /api/classes  -> class metadata from Postgres
│   └── battle.js           # POST /api/battle   -> resolves the fight server-side
├── db/
│   ├── schema.sql          # Postgres (Neon) tables: classes, units
│   └── seed.mjs            # `npm run db:seed` — runs schema + loads data/ rows
├── public/
│   ├── sprites/            # future sprite-sheet PNGs (referenced as /sprites/..)
│   └── audio/              # future SFX/music (referenced as /audio/..)
└── src/
    ├── main.js             # ENTRY: imports CSS, inits modules, wires buttons
    ├── config.js           # COLORS, accentFor(), cutscene timings
    ├── styles/
    │   ├── base.css        # design tokens (:root vars), globals, controls, log
    │   ├── board.css       # battlefield, unit cards, clash zone
    │   └── cutscene.css    # the full-screen attack cutscene
    ├── data/               # STATIC CONTENT (the future DB seed)
    │   ├── classes.js      # CLASS_META: attackName + fx type per class
    │   ├── sprites.js      # SPRITES manifest: sprite id -> sheet + frame grid
    │   └── units.js        # ROSTER_A / ROSTER_B unit definitions
    ├── services/           # I/O BOUNDARY (swap local -> Postgres/Firebase here)
    │   ├── content.js      # loadRosters/loadClasses/loadSprites (async)
    │   └── storage.js      # savePlayer/loadPlayer (localStorage, versioned)
    ├── core/
    │   ├── units.js        # makeUnit(), cloneRoster(), firstAlive, aliveCount
    │   ├── state.js        # shared `state` + initContent()/resetState()
    │   ├── resolve.js      # PURE combat engine (no DOM) — runs on the server, the
    │   │                   #   single source of truth; returns an event log
    │   └── battle.js       # client REPLAYER: requestBattle() then animate events
    ├── ui/
    │   ├── board.js        # renderBoard(), card building, HP updates
    │   ├── sprite.js       # spriteEl()/setAction() — CSS PNG-sprite renderer
    │   ├── dragdrop.js     # pointer-based drag-to-swap (mouse + touch)
    │   └── log.js          # battle log panel
    ├── cutscene/
    │   ├── cutscene.js     # builds + plays one attack cutscene (Promise)
    │   ├── portraits.js    # portraitSVG(unit, accent) — per class (SVG fallback)
    │   └── effects.js      # effectSVG(fx, accent) — per fx type
    └── (public/sprites/)   # uNN.png sheets + TEMPLATE.md (Nano Banana spec)
    └── utils/
        └── helpers.js      # sleep(), cssVar(), hpColor()
```

### Data model

A unit **definition** (in `data/units.js`):
```js
{ name: "Garran", cls: "Knight", emoji: "🛡️", hp: 130, atk: 24, spd: 6, sprite: "u01" }
```
At battle start, `makeUnit()` clones each def into a live **instance** adding
`{ id, maxHp, hp, alive }`. Lane order = array order; index 0 is the FRONT.
Each def also carries a stable `idx` (its original lane index, tagged in
`initContent()`); this is the key the client and server agree on — a chosen
order is just the list of unit `idx`, and server event logs reference units by
`{ side, idx }`. The client `id` is local-only and never sent to the server.

Two independent linking keys:
- **`cls`** links stats (`data/units.js`) → attack name + fx (`data/classes.js`)
  → effect (`cutscene/effects.js`).
- **`sprite`** (optional) links to a sheet entry in `data/sprites.js`, rendered
  by `ui/sprite.js`. Kept separate from `cls` so look and stats vary freely; a
  unit with no `sprite` falls back to its `emoji`.

**Content vs. I/O:** `data/` holds static content (the eventual DB seed). Nothing
in `core/`/`ui/` imports `data/` rosters directly — they go through
`services/content.js` (async). Moving to Postgres/Firebase = rewrite that one
file's bodies; callers already `await`. Stable string ids (`sprite:"u01"`,
class names) are the DB keys. Persisted player data goes through
`services/storage.js`, which version-tags blobs (`SCHEMA`).

### Combat flow (server-authoritative)

`setup` → player arranges units → `battle` → `over`.

On Start, the client posts only the two lane **orders** (`playerOrder`,
`enemyOrder` — permutations of unit `idx`) to `POST /api/battle`. The server
(`api/battle.js`) loads the authoritative stats from Postgres, **validates each
order is a legal permutation** (`applyOrder()` rejects duplicated/dropped/out-of-
range lanes — stats never come from the client), runs the pure engine
`core/resolve.js`, and returns `{ youWin, survivor, events }`. The client
`runBattle()` in `core/battle.js` then **replays** that event log (`duel` /
`strike` / `fall`) — cutscenes, HP bars, lane shifts. The client decides nothing
about the outcome, so tampering only fools its own screen.

The single damage choke point is now `strike()` in **`core/resolve.js`** (server
side). Because `resolve.js` is pure and DOM-free, it is imported by both the
serverless function and — for reference/testing — the browser.

> Today the client still chooses the *enemy* order too (a lesser "strategy"
> exploit, not result-tampering). See §6 for the planned hardening.

## 4. How to extend (recipes)

**Add a unit to an existing class:** add an entry to `ROSTER_A`/`ROSTER_B` in
`src/data/units.js`. (Armies are 3 wide today only because the rosters are 3
long; the engine already loops over whatever length you give it.)

**Add sprite art for a unit:** generate a sheet per `public/sprites/TEMPLATE.md`
(96px cells, rows idle/attack/defend/dead, 4 frames), save as
`public/sprites/units/uNN.png`, add a `SPRITES` entry in `src/data/sprites.js`,
and set `sprite: "uNN"` on the unit def. No code branches.

**Move content to a database (Postgres/Firebase):** rewrite the bodies of
`src/services/content.js` to `fetch()`/SDK calls returning the same shapes; keep
ids stable. `core/state.js` `initContent()` already awaits it. Seed the DB from
the current `data/` modules.

**Add a new unit class:**
1. `src/data/classes.js` → add `CLASS_META` entry (`attackName`, `fx`).
2. `src/cutscene/portraits.js` → add a `case "<Class>"` returning an `<svg>`.
3. `src/cutscene/effects.js` → add a `case "<fx>"` returning an `<svg>`, and a
   matching `.fx-<fx>` keyframe animation in `src/styles/cutscene.css`.
4. Use the class in a roster in `src/data/units.js`.

> ⚠️ Combat rules live on the SERVER now. Any change to how a fight resolves
> goes in `core/resolve.js` (the authoritative engine), and usually also needs a
> new/extended **event** field so the client replayer in `core/battle.js` can
> animate it. Don't compute outcomes in `core/battle.js` — it only replays.
> `api/battle.js` (which imports `resolve.js`) must be able to run the new path
> from DB stats alone; never trust client-sent values. The roster query in
> `api/battle.js` and `api/rosters.js` must `SELECT` any new stat column.

**Add a stat (e.g. defense):** add the field to defs in `data/units.js` (+ the
`units` table in `db/schema.sql` and the `SELECT` in `api/rosters.js` /
`api/battle.js`), show it in the card markup in `ui/board.js` (`.stats` block),
and apply it in `strike()` in `core/resolve.js`.

**Add status effects (poison/shield/stun):** initialize a `status: []` array in
`liveUnit()` (`core/resolve.js`) — and mirror it in `makeUnit()` (`core/units.js`)
if the client needs it for display. Apply/tick effects inside `resolveBattle()`
(in `strike()` before/after damage and at the duel boundary), emitting events
for each change. Surface active statuses on the card in `ui/board.js` and
optionally at the cutscene impact moment in `cutscene/cutscene.js`.

**Add skills:** create `src/data/skills.js` (skill definitions) + resolve them
inside `core/resolve.js` (server-authoritative), reference skills from unit defs,
and emit skill events for the `core/battle.js` replayer. Give each skill its own
cutscene effect via the same `effects.js` + `cutscene.css` pattern.

**Swap procedural portraits for sprite art:** put PNGs in `public/sprites/` and
change `portraitSVG()` (or add a sibling `portraitImg()`) to return
`<img src="/sprites/knight.png">`. Frame animation can use CSS `steps()` on a
sprite sheet, or move rendering to `<canvas>`.

**If the game outgrows the DOM** (many moving objects, particle-heavy combat):
consider migrating rendering to a 2D engine like **Phaser** while keeping the
`data/` and `core/` logic largely intact.

## 5. Conventions

- Keep **logic (core) free of DOM** beyond what's already there; pass UI
  behavior in as hooks (see `runBattle`).
- Prefer **adding data** over hardcoding: new content should mostly be new
  entries in `data/`, not new branches scattered through logic.
- Faction colors exist in two synced places: CSS vars `--a`/`--b` in
  `styles/base.css` and `COLORS` in `config.js`. Update both.
- Cutscene CSS keyframes are authored against a **2.1s timeline with impact at
  ~66%**; `CUTSCENE` timings in `config.js` must stay in sync if retimed.
- One module = one responsibility. If a file starts doing two jobs, split it.
- After non-trivial changes, run `npm run build` to confirm it still compiles.

## 6. Known simplifications (today)

- Armies are fixed at 3; no defense/crit/variance; deterministic outcomes.
- Cinematic plays one cutscene per individual strike (faithful but lengthy on
  long duels — there's a skip, and a Cinematic Off mode).
- No sound; no AI opponent logic (enemy order is random/shuffle, chosen client-side).
- Battle resolution is server-authoritative (`/api/battle`), but the **result
  is not persisted** — the server resolves statelessly and returns the log.

### Anti-cheat status & roadmap

- **Done:** outcome + stats are server-authoritative. The client sends only lane
  orders; `applyOrder()` validates them; the client can't fake/modify a result.
- **Known gap (accepted for now):** the client also picks the **enemy** order,
  so it could arrange the enemy favorably. This is a strategy exploit, not
  result-tampering, and existed before the server move.
- **Final goal (not yet implemented):** make the enemy order server-decided and
  tamper-proof. Likely shape: a short-lived **match session** — `POST /api/match`
  creates a match, the server picks + stores the enemy order, returns a
  `matchId` + the enemy lineup to display; `POST /api/battle` then takes
  `{ matchId, playerOrder }` and resolves against the stored enemy order (also
  the natural place to persist results and reject replays). Requires a `matches`
  table in `db/schema.sql`.
