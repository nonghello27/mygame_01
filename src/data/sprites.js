// Sprite manifest. Decouples a unit's VISUAL (its sprite sheet) from its CLASS
// (stats + attack fx). One entry per sheet; the key (e.g. "u01") is the stable
// id a unit definition references via its `sprite` field, and the row a future
// database would key on. NOTHING here is logic — it's pure data, so it can be
// seeded into Postgres/Firebase unchanged later.
//
// Sheet contract (see public/sprites/TEMPLATE.md): one PNG per unit, a grid of
// `cols` columns × N action rows, every cell `cell`×`cell` px, transparent bg,
// character centered + facing RIGHT (enemy side is flipped in CSS).
//
// To add art: drop the PNG in public/sprites/units/, add an entry here, then
// point a unit's `sprite` field at the new id. No code branches to touch.

// Two kinds of sprite entry are supported (see ui/sprite.js):
//   • SHEET portrait  — animated PNG grid (cell/cols/fps/actions), e.g. u01.
//   • IMAGE portrait  — a single still PNG (`img`), shown big above the unit
//     card. The art is authored on a solid #FF007F (magenta) background which
//     ui/chroma.js keys out to transparency at load, so no pre-processing of the
//     PNG files is needed — just export with that background color.

/**
 * @typedef {Object} SpriteDef
 * @property {string} [img]    Public path to a single still portrait PNG (IMAGE kind).
 * @property {string} [sheet]  Public path to a sprite-sheet PNG (SHEET kind).
 * @property {number} [cell]   Sheet cell size in px (square).
 * @property {number} [cols]   Sheet frames per action (columns in the grid).
 * @property {number} [fps]    Sheet playback speed for animated actions.
 * @property {Record<string, number>} [actions]  Sheet action name -> row index.
 */

/** @type {Record<string, SpriteDef>} */
export const SPRITES = {
  // Single-image portraits (magenta-keyed at runtime).
  u1: { img: "/sprites/units/u-1.png" }, // golden dragon
  u2: { img: "/sprites/units/u-2.png" }, // skeletal horseman
  u3: { img: "/sprites/units/u-3.png" }, // lava golem
  u4: { img: "/sprites/units/u-4.png" }, // armored knight
  u5: { img: "/sprites/units/u-5.png" }, // wizard
  u6: { img: "/sprites/units/u-6.png" }, // archer

  // Legacy animated sheet (kept as a reference for the sheet rendering path).
  u01: {
    sheet: "/sprites/units/u01.png",
    cell: 96,
    cols: 4,
    fps: 6,
    actions: { idle: 0, attack: 1, defend: 2, dead: 3 },
  },
};

/** Look up a sprite def by id (returns null if the unit has no sprite yet). */
export const spriteFor = (id) => (id && SPRITES[id]) || null;
