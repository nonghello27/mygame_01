# Sprites

Drop sprite-sheet PNGs here for future frame-based animations (the current
unit art is procedural SVG in `src/cutscene/portraits.js`).

Files in `public/` are served from the site root, so a file at
`public/sprites/knight.png` is referenced in code as `/sprites/knight.png`.

Suggested convention: one sheet per unit class, e.g. `knight.png`,
`archer.png`, plus a small JSON describing frame size / counts if needed.
