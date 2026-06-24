# Battle Line

A tactical lane-battle game prototype. Two armies face off; the front units
duel, and the survivor advances to the next enemy. Arrange your units (drag to
swap) before the fight. Optional Super-Robot-Wars-style attack cutscenes.

Built with **vanilla JS + ES modules** and **Vite**. No framework. Deploys as a
static site.

## Run it locally

Requires [Node.js](https://nodejs.org/) 18+.

```bash
npm install
npm run dev
```

Open the URL it prints (default http://localhost:5173).

```bash
npm run build     # production build → dist/
npm run preview   # serve the built dist/ locally
```

## Deploy to Vercel

Easiest path:

1. Push this folder to a GitHub repo.
2. In Vercel → **New Project** → import the repo. Vercel auto-detects Vite
   (build `npm run build`, output `dist/`). Click **Deploy**.

Or from the CLI in this folder:

```bash
npm i -g vercel    # once
vercel             # preview deploy
vercel --prod      # production deploy
```

## Project layout

See **[CLAUDE.md](./CLAUDE.md)** for the full architecture, data model, and
step-by-step recipes for adding units, classes, stats, status effects, and
skills. Short version:

- `src/data/` — units and class metadata (most new content goes here)
- `src/core/` — game state and the combat engine (DOM-free)
- `src/ui/` — board rendering, drag-to-swap, battle log
- `src/cutscene/` — the attack cutscene + procedural portraits/effects
- `src/styles/` — design tokens, board styles, cutscene styles
- `public/` — `sprites/` and `audio/` for future assets

## Controls

- **Drag** a unit card onto another (same army) to swap their lane order.
- **Start Battle** auto-resolves the fight.
- **Cinematic: On/Off** toggles the full-screen attack cutscenes. During a
  cutscene, tap or press space/esc to skip.
- **Randomize Enemy** reshuffles the enemy lineup; **Reset** restores both armies.
