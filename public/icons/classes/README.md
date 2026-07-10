# Class icons

One small icon per unit class, shown in the class-icon tile at the left of
every unit card's header row (`unitCardEl()` in `src/ui/board.js`). Its
native `title`/`alt` tooltip is the class name, so the tile no longer needs
its own text label.

## Naming

Filename = the class name **lowercased**, e.g. `Knight` -> `knight.png` /
`knight.svg`.

The card tries, in order:

1. `<class>.png`
2. `<class>.svg`
3. `default.svg` (always present — the fallback for any class without its
   own art, or while art is missing)

So replacing an icon is just dropping a same-named `.png` in this folder —
no code change needed.

## Recommended size

Roughly **64×64**, transparent background, a simple flat glyph that reads
clearly at the ~17px the card actually renders it at. The shipped `.svg`
placeholders use a `viewBox="0 0 64 64"` light stroke on a dark tile — match
that contrast if you're drawing raster replacements too.

## Current set (placeholders, `src/data/classes.js`'s `CLASS_META` keys)

- `knight.svg` — shield
- `archer.svg` — bow
- `lancer.svg` — lance
- `raider.svg` — axe
- `shaman.svg` — orb
- `warbeast.svg` — tusks
- `default.svg` — generic fallback (unknown/missing class)
