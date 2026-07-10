# Skill icons

One small icon per skill, the same "class-icon tile" idea
(`public/icons/classes/README.md`) applied to skills.

## Naming

Filename = the icon's base name, PNG only, e.g. `normal.png`.

The lookup order, in order:

1. The `icon` column on that skill's row in the `skills` MASTER TABLE
   (e.g. `sk_slash` -> `icon: "slash"` -> `slash.png`) — seeded from
   `src/data/skills.js`, live-adjustable afterward in the admin console's
   ⚔ Skills tab, no redeploy.
2. The skill's `slot` name, when that column is empty — one of
   `passive`/`normal`/`ultimate` — e.g. a `normal`-slot skill with no
   explicit icon falls back to `normal.png`.
3. `default.png` (always present — the fallback for anything else).

So replacing an icon is just dropping a same-named `.png` in this folder —
no code change needed. Repointing a skill at *different* art is a one-line
`icon` edit in the admin console (or `src/data/skills.js`, for content
meant to ship with the repo) — no filename hunting through UI code.

## Recommended size

Roughly **64×64**, transparent background, a simple flat glyph that reads
clearly at small card sizes.

## Vector sources

Each shipped `.png` is a 64×64 rasterization of the sibling `.svg` file of
the same name — the `.svg`s stay in this folder as the editable vector
sources, they're just no longer referenced by any code. Re-rasterize one
after editing its `.svg` with:

```
qlmanage -t -s 64 -o <output-dir> public/icons/skills/<name>.svg
```

(macOS QuickLook; move/rename the resulting `<name>.svg.png` to
`<name>.png`.) Or just drop in any 64×64 transparent PNG directly — the
`.svg` isn't required.

## Current set (the three `SKILL_SLOTS` placeholders + the fallback)

- `normal.png` — a single sword/blade (the everyday skill)
- `ultimate.png` — a starburst (the big one)
- `passive.png` — a rising aura / concentric arcs
- `default.png` — generic "?" fallback (unknown/missing icon)
