# Class icons

One small icon per unit class, shown in the class-icon tile at the left of
every unit card's header row (`unitCardEl()` in `src/ui/board.js`). Its
native `title`/`alt` tooltip is the class name, so the tile no longer needs
its own text label.

## Naming

Filename = the icon's base name, PNG only, e.g. `knight.png`.

The card looks up, in order:

1. The `icon` column on that class's row in the `classes` MASTER TABLE
   (e.g. `Knight` -> `icon: "knight"` -> `knight.png`) — seeded from
   `src/data/classes.js`'s `CLASS_META`, but live-adjustable afterward in
   the admin console's 🎭 Classes tab (with an image preview), no redeploy.
2. The class name lowercased, when that column is empty (e.g. an
   admin-created live class that never set one) — `<class>.png`.
3. `default.png` (always present — the fallback for any class whose art is
   missing entirely).

So replacing an icon is just dropping a same-named `.png` in this folder —
no code change needed. Repointing a class at *different* art is a one-line
`icon` edit in the admin console (or `CLASS_META`, for content meant to
ship with the repo) — no filename hunting through UI code.

## Recommended size

Roughly **64×64**, transparent background, a simple flat glyph that reads
clearly at the ~17px the card actually renders it at.

## Vector sources

Each shipped `.png` is a 64×64 rasterization of the sibling `.svg` file of
the same name — the `.svg`s stay in this folder as the editable vector
sources, they're just no longer referenced by any code. Re-rasterize one
after editing its `.svg` with:

```
qlmanage -t -s 64 -o <output-dir> public/icons/classes/<name>.svg
```

(macOS QuickLook; move/rename the resulting `<name>.svg.png` to
`<name>.png`.) Or just drop in any 64×64 transparent PNG directly — the
`.svg` isn't required.

## Current set (`src/data/classes.js`'s `CLASS_META` keys)

- `knight.png` — shield
- `archer.png` — bow
- `lancer.png` — lance
- `raider.png` — axe
- `shaman.png` — orb
- `warbeast.png` — tusks
- `default.png` — generic fallback (unknown/missing class)
