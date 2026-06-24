# AGENTS.md

This repo's full context, architecture, and contribution conventions live in
**[CLAUDE.md](./CLAUDE.md)**. Read it first.

Quick facts:
- Vanilla JS + ES modules, built with Vite. No framework.
- `npm run dev` to develop, `npm run build` to produce `dist/`.
- Game logic in `src/core/`, data in `src/data/`, rendering in `src/ui/` and
  `src/cutscene/`. Keep logic DOM-free; add content as data, not code branches.
