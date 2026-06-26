// Sprite rendering. Builds a CSS PNG-sprite element for a unit and lets callers
// swap its action (idle / attack / defend / dead). This is the single seam that
// both the battlefield cards (ui/board.js) and the cutscene (cutscene/cutscene.js)
// route through, so art changes never touch combat logic.
//
// Animation is pure CSS: each action is one ROW of the sheet, played across its
// COLUMNS with `steps(cols)` (see the .sprite rules in styles/sprite.css).
// Units without a `sprite` field fall back to their emoji, so the game still
// runs before any art exists.

import { spriteFor } from "../data/sprites.js";
import { chromaKeyed } from "./chroma.js";

/**
 * Build the visual element for a unit.
 * @param {object} unit  live unit instance (uses unit.sprite, unit.emoji)
 * @param {string} [action="idle"]
 * @returns {HTMLElement}
 */
export function spriteEl(unit, action = "idle") {
  const def = spriteFor(unit.sprite);

  // Fallback: no sprite -> emoji tile (keeps the old look working).
  if (!def) {
    const el = document.createElement("div");
    el.className = "unit-emoji";
    el.textContent = unit.emoji || "";
    return el;
  }

  // IMAGE kind: a single still portrait, magenta-keyed to transparency. The
  // <img> is returned immediately and its src filled once keying finishes
  // (cached, so it is effectively instant after the first time).
  if (def.img) {
    const img = document.createElement("img");
    img.className = "portrait-img";
    img.alt = unit.name || "";
    img.draggable = false;
    chromaKeyed(def.img)
      .then((url) => { img.src = url; })
      .catch(() => { img.src = def.img; }); // fall back to the raw (magenta) image
    return img;
  }

  const el = document.createElement("div");
  el.className = "sprite";
  // CSS custom props drive size, sheet image and the steps() frame count.
  el.style.setProperty("--cell", def.cell + "px");
  el.style.setProperty("--sheet", `url("${def.sheet}")`);
  el.style.setProperty("--cols", def.cols);
  el.style.setProperty("--sheet-w", def.cols * def.cell + "px");
  el.style.setProperty("--dur", def.cols / def.fps + "s");
  el.dataset.sprite = unit.sprite;
  setAction(el, unit, action);
  return el;
}

/**
 * Switch which action a sprite element is playing. Restarts the CSS animation
 * so re-triggering the same action (e.g. attack twice) replays it.
 * @param {HTMLElement} el  element returned by spriteEl()
 * @param {object} unit
 * @param {string} action
 */
export function setAction(el, unit, action) {
  const def = spriteFor(unit.sprite);
  if (!def || !el.classList.contains("sprite")) return;
  const row = def.actions[action] ?? def.actions.idle ?? 0;
  el.style.setProperty("--row-y", -(row * def.cell) + "px");
  el.dataset.action = action;
  // Reflow to restart the animation from frame 0.
  el.style.animation = "none";
  void el.offsetWidth; // force reflow
  el.style.animation = "";
}
