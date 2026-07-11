// Goods media rendering. The one owner of item/equipment/rune icon lookup +
// DOM building — the same seam ui/skillMedia.js is for skill art,
// ui/board.js's classIconEl() is for class icons. Every caller (the 🎒
// Inventory panel, 🐾 Setup Monster's gear rows, the 🏪 Marketplace listing
// cards, the admin 🧰 Items/⚔ Equipment/🔮 Runes tabs) routes through here so
// art changes never touch inventory/UI logic elsewhere.
//
// One lookup chain, driven by each goods MASTER TABLE's `icon` column
// (item_defs/equipment_defs/rune_defs — riding every server read that joins
// the def, see CLAUDE.md's Phase 10.17 note):
//   good.icon || good.defId || (string good.id) || "default"
//     -> /icons/<dir>/<base>.png
// with the standard onerror-to-default.png loop-guarded fallback (the
// classIconEl()/skillIconEl() precedent).
//
// CAREFUL: an inventory INSTANCE row (owned equipment/runes) carries a
// NUMERIC instance `id` alongside its string `defId` — a numeric id must
// never leak into the icon URL, hence the typeof guard below. Admin DEF rows
// (item_defs/equipment_defs/rune_defs) have only a string `id` and no
// `defId`, so that branch is what covers them.

/**
 * Build a good's icon `<img>`.
 * @param {"items"|"equipment"|"runes"} dir  the public/icons/ subfolder
 * @param {object} good  any object carrying optional `icon`/`defId`/`id`/`name`
 *   (an inventory row, a marketplace listing's `good`, or an admin def row)
 * @param {number} [size=20]
 * @returns {HTMLImageElement}
 */
export function goodIconEl(dir, good, size = 20) {
  const base = good?.icon || good?.defId || (typeof good?.id === "string" ? good.id : null) || "default";
  const img = document.createElement("img");
  img.className = "good-icon-img";
  img.alt = good?.name || "";
  img.title = good?.name || "";
  img.draggable = false;
  img.width = size;
  img.height = size;
  img.src = `/icons/${dir}/${base}.png`;
  img.onerror = () => {
    img.onerror = null; // guard: a missing default.png must not loop
    img.src = `/icons/${dir}/default.png`;
  };
  return img;
}
