// Drag-to-swap, riding the shared ui/pointerDrag.js hold-to-drag/swipe-to-
// scroll engine (Phase 10.15) so it works identically on mouse and touch
// (native HTML5 drag-and-drop is unreliable on mobile): mouse drags on a
// small movement threshold, touch/pen drags only after a press-and-hold so
// a swipe across the stacked army rows still scrolls the page. Units only
// swap within their own army, and only during the "setup" phase.

import { state } from "../core/state.js";
import { beginPointerDrag } from "./pointerDrag.js";

/**
 * Make a card draggable. On a valid drop onto a same-army card, the two units
 * swap lane positions and `onSwap` is called to re-render.
 * @param {HTMLElement} card
 * @param {"a"|"b"} side
 * @param {() => void} onSwap
 */
export function enableDragSwap(card, side, onSwap) {
  card.addEventListener("pointerdown", (e) => {
    if (state.phase !== "setup") return;
    beginPointerDrag(e, {
      sourceEl: card,
      // The clone is reparented to <body>, losing its `.army-a`/`.army-b`
      // ancestor — re-add the side class so army-scoped styling (notably
      // the enemy sprite's left-facing flip) still applies while dragging.
      cloneClasses: ["drag-clone", "army-" + side],
      findTarget: (under) => {
        const tCard = under.closest(".unit-card");
        return tCard && tCard !== card && tCard.dataset.side === side ? tCard : null;
      },
      onDrop: (target) => {
        if (target) swapUnits(side, card.dataset.id, target.dataset.id);
        onSwap();
      },
    });
  });
}

function swapUnits(side, idA, idB) {
  const arr = side === "a" ? state.armyA : state.armyB;
  const i = arr.findIndex((u) => u.id === idA);
  const j = arr.findIndex((u) => u.id === idB);
  if (i < 0 || j < 0) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
