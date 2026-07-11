# Item icons

One small icon per item, the same "class-icon tile" idea
(`public/icons/classes/README.md`) applied to items.

## Naming

Filename = the icon's base name, PNG only, e.g. `it_potion_small.png`.

The lookup order, in order:

1. The `icon` column on that item's row in the `item_defs` MASTER TABLE
   (e.g. `it_potion_small` -> `icon: "potion"` -> `potion.png`) — live-
   adjustable in the admin console's 🧰 Items tab (with an image preview),
   no redeploy.
2. The item's own `id`, when that column is empty (e.g. `it_potion_small` ->
   `it_potion_small.png`).
3. `default.png` (always present — the fallback for anything else).

So replacing an icon is just dropping a same-named `.png` in this folder —
no code change needed. Repointing an item at *different* art is a one-line
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
qlmanage -t -s 64 -o <output-dir> public/icons/items/<name>.svg
```

(macOS QuickLook; move/rename the resulting `<name>.svg.png` to
`<name>.png`.) Or just drop in any 64×64 transparent PNG directly — the
`.svg` isn't required.

## Current set

- `default.png` — a drawstring pouch (generic fallback for any item with no
  dedicated icon and no matching-id art yet)
