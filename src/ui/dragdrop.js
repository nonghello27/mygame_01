// Drag-to-swap using Pointer Events so it works identically on mouse and touch
// (native HTML5 drag-and-drop is unreliable on mobile). Units only swap within
// their own army, and only during the "setup" phase.

import { state } from "../core/state.js";

let drag = null;

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
    e.preventDefault();

    const rect = card.getBoundingClientRect();
    const clone = card.cloneNode(true);
    clone.classList.add("drag-clone");
    // The clone is reparented to <body>, losing its `.army-a`/`.army-b`
    // ancestor — re-add the side class so army-scoped styling (notably the
    // enemy sprite's left-facing flip) still applies while dragging.
    clone.classList.add("army-" + side);
    clone.style.width = rect.width + "px";
    clone.style.left = rect.left + "px";
    clone.style.top = rect.top + "px";
    document.body.appendChild(clone);
    card.classList.add("dragging-src");

    drag = {
      card, side, clone, onSwap,
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      target: null,
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  });
}

function onMove(e) {
  if (!drag) return;
  drag.clone.style.left = e.clientX - drag.dx + "px";
  drag.clone.style.top = e.clientY - drag.dy + "px";
  drag.clone.style.transform = "rotate(-3deg) scale(1.05)";

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const tCard = under ? under.closest(".unit-card") : null;
  if (drag.target && drag.target !== tCard) drag.target.classList.remove("drop-target");
  if (tCard && tCard !== drag.card && tCard.dataset.side === drag.side) {
    tCard.classList.add("drop-target");
    drag.target = tCard;
  } else {
    drag.target = null;
  }
}

function onUp() {
  if (!drag) return;
  window.removeEventListener("pointermove", onMove);
  if (drag.target) {
    swapUnits(drag.side, drag.card.dataset.id, drag.target.dataset.id);
  }
  drag.clone.remove();
  drag.card.classList.remove("dragging-src");
  if (drag.target) drag.target.classList.remove("drop-target");
  const cb = drag.onSwap;
  drag = null;
  cb();
}

function swapUnits(side, idA, idB) {
  const arr = side === "a" ? state.armyA : state.armyB;
  const i = arr.findIndex((u) => u.id === idA);
  const j = arr.findIndex((u) => u.id === idB);
  if (i < 0 || j < 0) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
