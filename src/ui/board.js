// Renders the battlefield: both armies, each unit card, the front-line markers,
// and the small per-card HP updates the battle loop drives.

import { state } from "../core/state.js";
import { firstAlive } from "../core/units.js";
import { hpColor } from "../utils/helpers.js";
import { enableDragSwap } from "./dragdrop.js";
import { spriteEl } from "./sprite.js";
import { powerScore } from "../../shared/rules/formulas.js";

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

/**
 * Build one battlefield-style unit card: portrait + info plate (pos badge,
 * a header row — class-icon tile, name, rank badge/power — an HP bar, and a
 * 2x2 stat-tile grid). Pure markup — no dataset, no drag, no front-lane
 * marker; `buildCard()` below layers those battlefield concerns on top.
 * Shared with ui/team.js (Phase 10.8) so the Setup Team panel renders the
 * same cards the battlefield does.
 * @param {object} u a unit (live battle unit, or any display lane shaped the
 *   same way: hp/maxHp/name/cls/element/atk range/matk range/spd/alive,
 *   optionally rank + equipment[]/equipmentCount + runes[]/runeCount)
 * @param {string} posLabel badge text, e.g. "A1"/"B2" — pass "" for none
 */
export function unitCardEl(u, posLabel) {
  const card = document.createElement("div");
  card.className = "unit-card";
  if (!u.alive) card.classList.add("dead");
  if (u.rank != null) card.classList.add(`rank-${String(u.rank).toLowerCase()}`);

  const ratio = u.hp / u.maxHp;
  const runeCount = u.runes?.length ?? u.runeCount ?? 0;
  const equipCount = u.equipment?.length ?? u.equipmentCount ?? 0;
  // Display-only "power" number (Phase 10.9) — the same powerScore() the
  // rank badge sits under; never sent anywhere. Battle/display lanes both
  // already carry the deriveStats() fields powerScore() reads.
  const rankBlock = u.rank != null
    ? `<span class="unit-rank-badge">${u.rank}</span><span class="unit-rank-power">${powerScore(u)}</span>`
    : "";

  card.innerHTML = `
    <div class="unit-portrait-top"></div>
    <div class="unit-plate">
      <span class="badge-pos">${posLabel}</span>
      <span class="front-flag">FRONT</span>
      <div class="unit-head">
        <div class="unit-class-icon"></div>
        <div class="unit-name">${u.name}${elementIcon(u.element)}</div>
        <div class="unit-rank">${rankBlock}</div>
      </div>
      <div class="hp-wrap">
        <div class="hp-top">
          <span class="lbl">❤️ HP</span>
          <span class="val"><span class="hp-now">${Math.max(0, Math.round(u.hp))}</span>/${u.maxHp}</span>
        </div>
        <div class="hp-bar"><div class="hp-fill" style="width:${ratio * 100}%;background:${hpColor(ratio)}"></div></div>
      </div>
      <div class="stats">
        <div class="stat" title="Attack"><span class="s-ico">⚔️</span><span class="s-val">${atkLabel(u)}</span></div>
        <div class="stat" title="Speed"><span class="s-ico">⚡</span><span class="s-val">${u.spd}</span></div>
        <div class="stat" title="Runes"><span class="s-ico">🔮</span><span class="s-val">${runeCount}</span></div>
        <div class="stat" title="Equipment"><span class="s-ico">🛡️</span><span class="s-val">${equipCount}</span></div>
      </div>
    </div>
  `;

  // Mount the unit's portrait (or emoji fallback) above the info plate. The
  // card is built on the front lane idle by default; combat can swap actions.
  card.querySelector(".unit-portrait-top").appendChild(spriteEl(u, u.alive ? "idle" : "dead"));
  card.querySelector(".unit-class-icon").appendChild(classIconEl(u.cls));
  return card;
}

function buildCard(u, side, lane) {
  const posLabel = (side === "a" ? "A" : "B") + lane;
  const card = unitCardEl(u, posLabel);
  // Insert "no-drag" right after "unit-card" (not appended after "dead") so
  // the className string matches pre-extraction byte-for-byte.
  if (state.phase !== "setup") card.className = card.className.replace("unit-card", "unit-card no-drag");
  card.dataset.id = u.id;
  card.dataset.side = side;

  // Only YOUR army is arrangeable — the enemy's lane order is part of the
  // server's match snapshot (rearranging it client-side would be a lie).
  if (state.phase === "setup" && side === "a") enableDragSwap(card, side, renderBoard);
  return card;
}

const ELEMENT_ICONS = {
  fire: "🔥", water: "💧", wind: "🌪️", earth: "⛰️", holy: "✨", dark: "🌑",
};
const elementIcon = (el) => (ELEMENT_ICONS[el] ? ` ${ELEMENT_ICONS[el]}` : "");

/**
 * Build the class-icon tile's `<img>` (Phase 10.9) — its `title`/`alt` is
 * the class name (a native tooltip replaces the old text label). Tries
 * `<class>.png`, then `.svg`, then a shared `default.svg`, so a user can
 * drop in replacement art under public/icons/classes/ without touching
 * code (see that dir's README.md) — same public-asset path style as
 * ui/sprite.js's `/sprites/...` references.
 */
function classIconEl(cls) {
  const lower = String(cls || "").toLowerCase();
  const img = document.createElement("img");
  img.className = "unit-class-icon-img";
  img.alt = cls || "";
  img.title = cls || "";
  img.draggable = false;
  img.src = `/icons/classes/${lower}.png`;
  img.onerror = () => {
    img.onerror = () => {
      img.onerror = null; // guard: a missing default.svg must not loop
      img.src = "/icons/classes/default.svg";
    };
    img.src = `/icons/classes/${lower}.svg`;
  };
  return img;
}

/** "34–38" for v2 lanes (magic attackers show their MATK roll); plain atk otherwise. */
function atkLabel(u) {
  const [lo, hi] = u.attackStyle === "mag" ? [u.matkMin, u.matkMax] : [u.atkMin, u.atkMax];
  return lo !== undefined ? `${lo}–${hi}` : u.atk;
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

/** Floating "-N" (or a word like MISS) over a card. */
export function floatDamage(card, dmg) {
  const r = card.getBoundingClientRect();
  const f = document.createElement("div");
  f.className = "dmg-float";
  f.textContent = typeof dmg === "number" ? "-" + dmg : dmg;
  f.style.left = r.left + r.width / 2 + "px";
  f.style.top = r.top + 8 + "px";
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1000);
}
