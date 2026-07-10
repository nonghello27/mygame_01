# Skill animations

The future home of per-skill animation files, pointed at by the `animation`
column on the `skills` MASTER TABLE (seeded via `src/data/skills.js`,
live-adjustable in the admin console's ⚔ Skills tab — a follow-up round
wires that UI; this round only adds the column + these sample files).

## The extension rule

The `animation` column stores a full **filename, extension included** — the
extension alone picks the renderer, no separate "kind" field:

- **`.svg`** — a small **self-animating SVG**: the animation is authored
  INSIDE the file (a `<style>` block with CSS `@keyframes`, looping).
  CSS animations inside an SVG play fine when the file is loaded via a
  plain `<img src="...">` — no JS driver needed.
- **`.png`** — a **horizontal sprite strip of SQUARE frames**, one row.
  Frame count = width ÷ height (e.g. 384×96 = 4 frames of 96×96). Played
  the same way `public/sprites/` unit sheets are (see
  `public/sprites/TEMPLATE.md` / `src/ui/sprite.js`): CSS `steps(n)` timing
  stepping through the strip, one 96px-wide window shown at a time.

NULL means the skill has no animation yet — nothing renders (the follow-up
UI round decides the no-animation fallback).

## Naming

Lowercase, `[a-z0-9_-]`, extension required (`.svg` or `.png`) — the
column stores this exact filename, so renaming a file means updating every
skill row that points at it.

## Sample files (demo both branches, not real skill content)

- `sample_slash.svg` — a self-animating SVG: a diagonal slash stroke whose
  `stroke-dashoffset` sweeps across ~1.2s, looping, with a brief impact
  glow at the tip.
- `sample_slash.png` — a 384×96 horizontal strip, 4 square 96×96 frames,
  the same slash motion staged as 4 clearly visible progressive lengths
  (~25% / 50% / 75% / 100% of the stroke), the last frame adding an impact
  glow at the tip — each stage fully contained in its own cell at matching
  stroke weight, no faint or off-cell frames.

Neither is wired to any real skill — they exist purely so the next round's
admin UI / renderer has known-good fixtures for both extensions.
