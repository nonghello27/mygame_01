# CLAUDE.md — Battle Line

Project context for AI coding agents (Claude Code, Antigravity, etc.) and humans.
Read this before making changes.

## 1. Concept

**Battle Line** is a tactical lane-battle game. Each side fields a small column
of units (currently 3). The two **front** units duel; when one falls, the
survivor — keeping its remaining HP — advances to fight the next enemy unit.
The battle is fully auto-resolved; the player's agency is in **arranging unit
order before the fight** (drag to swap), which controls the matchups.

Combat is currently deterministic: damage is flat `atk`, higher `spd` strikes
first in a duel (ties favor the player). When **Cinematic** mode is on, each
strike plays a Super-Robot-Wars-style full-screen cutscene (letterbox bands,
dueling portraits, a class-specific attack effect, impact flash + damage).

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
├── vite.config.js          # base:'./' so built assets are host-portable
├── vercel.json             # Vite static deploy config
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
    ├── data/
    │   ├── classes.js      # CLASS_META: attackName + fx type per class
    │   └── units.js        # ROSTER_A / ROSTER_B unit definitions
    ├── core/
    │   ├── units.js        # makeUnit(), cloneRoster(), firstAlive, aliveCount
    │   ├── state.js        # shared `state` + resetState()
    │   └── battle.js       # the combat loop (strike / fall / runBattle)
    ├── ui/
    │   ├── board.js        # renderBoard(), card building, HP updates
    │   ├── dragdrop.js     # pointer-based drag-to-swap (mouse + touch)
    │   └── log.js          # battle log panel
    ├── cutscene/
    │   ├── cutscene.js     # builds + plays one attack cutscene (Promise)
    │   ├── portraits.js    # portraitSVG(unit, accent) — per class
    │   └── effects.js      # effectSVG(fx, accent) — per fx type
    └── utils/
        └── helpers.js      # sleep(), cssVar(), hpColor()
```

### Data model

A unit **definition** (in `data/units.js`):
```js
{ name: "Garran", cls: "Knight", emoji: "🛡️", hp: 130, atk: 24, spd: 6 }
```
At battle start, `makeUnit()` clones each def into a live **instance** adding
`{ id, maxHp, hp, alive }`. Lane order = array order; index 0 is the FRONT.

The **class name** (`cls`) is the linking key across three files: stats live in
`data/units.js`, the portrait in `cutscene/portraits.js`, and the attack
name + effect type in `data/classes.js` (which maps to an effect in
`cutscene/effects.js`).

### Combat flow

`setup` → player arranges units → `battle` (runBattle loops duels) → `over`.
The single damage choke point is `strike()` in `core/battle.js`.

## 4. How to extend (recipes)

**Add a unit to an existing class:** add an entry to `ROSTER_A`/`ROSTER_B` in
`src/data/units.js`. (Armies are 3 wide today only because the rosters are 3
long; the engine already loops over whatever length you give it.)

**Add a new unit class:**
1. `src/data/classes.js` → add `CLASS_META` entry (`attackName`, `fx`).
2. `src/cutscene/portraits.js` → add a `case "<Class>"` returning an `<svg>`.
3. `src/cutscene/effects.js` → add a `case "<fx>"` returning an `<svg>`, and a
   matching `.fx-<fx>` keyframe animation in `src/styles/cutscene.css`.
4. Use the class in a roster in `src/data/units.js`.

**Add a stat (e.g. defense):** add the field to defs in `data/units.js`, show it
in the card markup in `ui/board.js` (`.stats` block), and apply it in `strike()`
in `core/battle.js`.

**Add status effects (poison/shield/stun):** initialize a `status: []` array in
`makeUnit()` (`core/units.js`). Create `src/core/status.js` to apply/tick
effects. Hook it inside `strike()` (before/after damage) and at the duel/turn
boundary in `runBattle()`. Surface active statuses on the card in `ui/board.js`
and optionally at the cutscene impact moment in `cutscene/cutscene.js`.

**Add skills:** create `src/data/skills.js` (skill definitions) + `src/core/
skills.js` (resolution), reference skills from unit defs, and trigger them in
`runBattle()`/`strike()`. Give each skill its own cutscene effect via the same
`effects.js` + `cutscene.css` pattern.

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
- No persistence, no sound, no AI opponent logic (enemy order is random/shuffle).
