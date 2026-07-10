# Status icons

One small icon per active status, shown in a row along the TOP of a unit's
portrait during battle (the `.unit-status-row` inside `.unit-portrait-top`,
built/updated by `unitCardEl()`/`updateCardStatuses()` in `src/ui/board.js`).
Icons fill left→right in the order the status was gained; each icon's native
`title`/`alt` tooltip is the status's display label.

## Naming

Filename = the icon's base name, PNG only, e.g. `stun.png`.

The card looks up, in order:

1. The base filename mapped for that status id in `src/data/statusIcons.js`'s
   `STATUS_ICONS` (e.g. `stun` -> `stun.png`).
2. The status id itself, for a status not in that map -> `<id>.png`.
3. `default.png` (always present — the fallback for any status whose art is
   missing entirely).

So replacing an icon is just dropping a same-named `.png` in this folder —
no code change needed. Repointing a status at *different* art is a one-line
edit in `STATUS_ICONS` — no filename hunting through UI code.

Status ids themselves come from the closed registry in
`shared/rules/statuses.js` (`STATUSES`) — that file's `label` field is what
the icon's tooltip shows.

## Recommended size

Roughly **64×64**, transparent background, a simple flat glyph that reads
clearly at the ~14px the card actually renders it at.

## Vector sources

Each shipped `.png` is a 64×64 rasterization of the sibling `.svg` file of
the same name — the `.svg`s stay in this folder as the editable vector
sources, they're just no longer referenced by any code. Re-rasterize one
after editing its `.svg` with:

```
qlmanage -t -s 64 -o <output-dir> public/icons/statuses/<name>.svg
```

(macOS QuickLook; move/rename the resulting `<name>.svg.png` to
`<name>.png`.) Or just drop in any 64×64 transparent PNG directly — the
`.svg` isn't required.

## Current set (`shared/rules/statuses.js`'s `STATUSES` keys)

- `stun.png` — Stunned
- `freeze.png` — Frozen
- `burn.png` — Burning
- `poison.png` — Poisoned
- `atk_up.png` — ATK Up
- `spd_up.png` — SPD Up
- `atk_down.png` — Cursed
- `default.png` — generic fallback (unknown/missing status)
