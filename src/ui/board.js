// Renders the battlefield: both armies, each unit card, the front-line markers,
// and the small per-card HP updates the battle loop drives.

import { state } from "../core/state.js";
import { firstAlive } from "../core/units.js";
import { hpColor } from "../utils/helpers.js";
import { enableDragSwap } from "./dragdrop.js";
import { spriteEl } from "./sprite.js";

let elA, elB, labelA, labelB;

export function initBoard() {
  elA = document.getElementById("armyA");
  elB = document.getElementById("armyB");
  labelA = elA.querySelector(".army-label");
  labelB = elB.querySelector(".army-label");
}

export function renderBoard() {
  // Army A renders BACK -> FRONT so its front sits nearest the clash zone.
  renderArmy(elA, [...state.armyA].reverse(), state.armyA, "a", labelA);
  // Army B renders FRONT -> BACK so its front sits nearest the clash zone.
  renderArmy(elB, state.armyB, state.armyB, "b", labelB);
  markFront();
}

function renderArmy(container, visualOrder, sourceArr, side, labelNode) {
  [...container.querySelectorAll(".unit-card")].forEach((n) => n.remove());
  visualOrder.forEach((u) => {
    const lane = sourceArr.indexOf(u) + 1; // 1 = front
    container.appendChild(buildCard(u, side, lane));
  });
  if (container.firstChild !== labelNode) container.insertBefore(labelNode, container.firstChild);
}

function buildCard(u, side, lane) {
  const card = document.createElement("div");
  card.className = "unit-card" + (state.phase !== "setup" ? " no-drag" : "");
  card.dataset.id = u.id;
  card.dataset.side = side;
  if (!u.alive) card.classList.add("dead");

  const ratio = u.hp / u.maxHp;
  const posLabel = (side === "a" ? "A" : "B") + lane;

  card.innerHTML = `
    <div class="unit-portrait-top"></div>
    <div class="unit-plate">
      <span class="badge-pos">${posLabel}</span>
      <span class="front-flag">FRONT</span>
      <div class="unit-head">
        <div class="unit-name">${u.name}</div>
        <div class="unit-class">${u.cls}</div>
      </div>
      <div class="hp-wrap">
        <div class="hp-top">
          <span class="lbl">HP</span>
          <span class="val"><span class="hp-now">${Math.max(0, Math.round(u.hp))}</span>/${u.maxHp}</span>
        </div>
        <div class="hp-bar"><div class="hp-fill" style="width:${ratio * 100}%;background:${hpColor(ratio)}"></div></div>
      </div>
      <div class="stats">
        <div class="stat" title="Attack"><span class="s-ico">⚔️</span><span class="s-val">${u.atk}</span></div>
        <div class="stat" title="Speed"><span class="s-ico">⚡</span><span class="s-val">${u.spd}</span></div>
      </div>
    </div>
  `;

  // Mount the unit's portrait (or emoji fallback) above the info plate. The
  // card is built on the front lane idle by default; combat can swap actions.
  card.querySelector(".unit-portrait-top").appendChild(spriteEl(u, u.alive ? "idle" : "dead"));

  // Only YOUR army is arrangeable — the enemy's lane order is part of the
  // server's match snapshot (rearranging it client-side would be a lie).
  if (state.phase === "setup" && side === "a") enableDragSwap(card, side, renderBoard);
  return card;
}

function markFront() {
  document.querySelectorAll(".unit-card").forEach((c) => c.classList.remove("front"));
  const fa = firstAlive(state.armyA);
  const fb = firstAlive(state.armyB);
  if (fa) cardEl(fa.id)?.classList.add("front");
  if (fb) cardEl(fb.id)?.classList.add("front");
}

/** Find a unit's card element by id. */
export const cardEl = (id) => document.querySelector(`.unit-card[data-id="${id}"]`);

/** Update a unit's on-card HP bar + number (with a hit shake). */
export function updateCardHp(unit) {
  const card = cardEl(unit.id);
  if (!card) return;
  card.classList.add("hit");
  const ratio = unit.hp / unit.maxHp;
  const fill = card.querySelector(".hp-fill");
  const now = card.querySelector(".hp-now");
  if (fill) { fill.style.width = ratio * 100 + "%"; fill.style.background = hpColor(ratio); }
  if (now) now.textContent = Math.round(unit.hp);
  setTimeout(() => card.classList.remove("hit"), 340);
}

/** Floating "-N" over a card (used when cinematic mode is off). */
export function floatDamage(card, dmg) {
  const r = card.getBoundingClientRect();
  const f = document.createElement("div");
  f.className = "dmg-float";
  f.textContent = "-" + dmg;
  f.style.left = r.left + r.width / 2 + "px";
  f.style.top = r.top + 8 + "px";
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1000);
}
