# Unit sprite-sheet template (for Nano Banana / any image gen)

Every unit is **one PNG sprite sheet** on a fixed grid. Keep the grid identical
for every unit so the engine can read any sheet with the same manifest math
(see `src/data/sprites.js`). The renderer is `src/ui/sprite.js` + `src/styles/sprite.css`.

## The grid (non-negotiable)

| property        | value                                             |
| --------------- | ------------------------------------------------- |
| cell size       | **96 × 96 px**                                     |
| columns (frames)| **4** (frame 1 → 4, left to right)                |
| rows (actions)  | **4**, in this exact order                        |
| sheet size      | **384 × 384 px** (4 × 4 cells)                     |
| background      | **transparent** (true alpha, not white)           |
| format          | **PNG-24 + alpha**                                 |

Row order (top → bottom) — must match `actions` in the manifest:

| row | action   | what it shows                                            |
| --- | -------- | -------------------------------------------------------- |
| 0   | `idle`   | standing, subtle breathing/bob across the 4 frames       |
| 1   | `attack` | wind-up → strike → follow-through → recover               |
| 2   | `defend` | brace/guard (raise shield or crouch), small motion       |
| 3   | `dead`   | falling → collapsed on the floor (last frame = resting)  |

## Art rules

- **Pixel art, limited palette** (8-bit feel); **no anti-aliasing / no soft blur**
  — hard pixel edges (the engine upscales with `image-rendering: pixelated`).
- **Face RIGHT.** The enemy side is mirrored automatically in CSS — never draw a
  left-facing version.
- **Center each pose horizontally**; **feet on a consistent baseline** (~12 px from
  the bottom of the cell) so the unit doesn't jump between frames/actions.
- Keep the silhouette inside the cell with a few px of padding; no bleeding into
  neighbours.
- Consistent light source (top-left) and scale across all 16 frames.

## Prompt skeleton for Nano Banana

> A 384×384 pixel-art sprite sheet on a transparent background, arranged as a
> 4×4 grid of 96×96 cells. Each row is a 4-frame animation of the SAME character
> facing right. Row 1: idle breathing. Row 2: melee attack (wind-up, strike,
> follow-through, recover). Row 3: defensive guard with a raised shield. Row 4:
> death collapse ending lying on the ground. 8-bit limited palette, hard pixel
> edges, no anti-aliasing, character centered with feet on a consistent baseline.
> Character: **<describe the unit — e.g. "armored knight in blue plate">**.

Generate, then **export/verify the grid is exactly 384×384 with 96 px cells**
(crop/realign if the model drifts). Drop it in `public/sprites/units/uNN.png`.

## Wiring a new sheet into the game

1. Save the PNG as `public/sprites/units/uNN.png` (e.g. `u02.png`).
2. Add a manifest entry in `src/data/sprites.js`:
   ```js
   u02: { sheet: "/sprites/units/u02.png", cell: 96, cols: 4, fps: 6,
          actions: { idle: 0, attack: 1, defend: 2, dead: 3 } },
   ```
3. Point a unit at it in `src/data/units.js`: add `sprite: "u02"` to its def.

That's it — no code branches. (If you change cell size or frame count for a
sheet, only that manifest entry changes; the renderer reads it.)

## Future sheet kinds (same idea, different folders)

- `public/sprites/fx/`  — skill/magic effect sheets (own manifest later).
- `public/sprites/bg/`  — battle backgrounds (static or animated strips).
