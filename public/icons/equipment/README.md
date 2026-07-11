# Equipment icons

One small icon per equipment piece, the same "class-icon tile" idea
(`public/icons/classes/README.md`) applied to equipment.

## Naming

Filename = the icon's base name, PNG only, e.g. `eq_iron_sword.png`.

The lookup order, in order:

1. The `icon` column on that piece's row in the `equipment_defs` MASTER
   TABLE (e.g. `eq_iron_sword` -> `icon: "sword"` -> `sword.png`) — live-
   adjustable in the admin console's ⚔ Equipment tab (with an image
   preview), no redeploy.
2. The piece's own `id`, when that column is empty (e.g. `eq_iron_sword` ->
   `eq_iron_sword.png`).
3. `default.png` (always present — the fallback for anything else).

So replacing an icon is just dropping a same-named `.png` in this folder —
no code change needed. Repointing a piece at *different* art is a one-line
`icon` edit in the admin console — no filename hunting through UI code.

## Recommended size

Roughly **64×64**, transparent background, a simple flat glyph that reads
clearly at small inventory-row sizes.

## Vector sources

Each shipped `.png` is a 64×64 rasterization of the sibling `.svg` file of
the same name — the `.svg`s stay in this folder as the editable vector
sources, they're just no longer referenced by any code. Re-rasterize one
after editing its `.svg` with:

```
qlmanage -t -s 64 -o <output-dir> public/icons/equipment/<name>.svg
```

(macOS QuickLook; move/rename the resulting `<name>.svg.png` to
`<name>.png`.) Or just drop in any 64×64 transparent PNG directly — the
`.svg` isn't required.

## Current set

- `default.png` — a sword (generic fallback for any equipment piece with no
  dedicated icon and no matching-id art yet)
