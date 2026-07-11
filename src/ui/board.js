// Renders the battlefield: both armies, each unit card, the front-line markers,
// and the small per-card HP updates the battle loop drives.

import { state } from "../core/state.js";
import { firstAlive } from "../core/units.js";
import { hpColor } from "../utils/helpers.js";
import { enableDragSwap } from "./dragdrop.js";
import { spriteEl } from "./sprite.js";
import { powerScore } from "../../shared/rules/formulas.js";
import { STATUS_ICONS } from "../data/statusIcons.js";
import { STATUSES } from "../../shared/rules/statuses.js";

let elA, elB;

export function initBoard() {
  elA = document.getElementById("armyA");
  elB = document.getElementById("armyB");
}

export function renderBoard() {
  // Both armies now render in STACKED rows (Phase 10.11), one above the
  // other, with the VS clash zone between them. Per playtest preference
  // (10.11 follow-up), the two rows use OPPOSITE visual orders: army A
  // (top) renders BACK -> FRONT, putting its front-line unit rightmost;
  // army B (bottom) renders FRONT -> BACK, putting its front-line unit
  // leftmost. The two fronts (A1, B1) end up diagonally opposite across
  // the VS row rather than aligned in the same column — that's the wanted
  // layout, not a bug. Reversing/not-reversing is visual DOM order only;
  // lane data — `lane` below still comes from `sourceArr.indexOf(u)+1` —
  // is untouched either way (the Phase 10.8 team-slots comment makes the
  // same point). The army labels themselves live in the clash zone's own
  // row (index.html), not inside either army container (10.11 follow-up).
  renderArmy(elA, [...state.armyA].reverse(), state.armyA, "a");
  renderArmy(elB, state.armyB, state.armyB, "b");
  markFront();
}

function renderArmy(container, visualOrder, sourceArr, side) {
  [...container.querySelectorAll(".unit-card")].forEach((n) => n.remove());
  visualOrder.forEach((u) => {
    const lane = sourceArr.indexOf(u) + 1; // 1 = front
    container.appendChild(buildCard(u, side, lane));
  });
}

/**
 * Build one battlefield-style unit card: portrait + info plate (pos badge,
 * a header row — a class-icon tile with an element-name label under it
 * (mirroring the rank badge/power column on the right), a centered
 * length-auto-fit name — an HP bar, and a 2x2 stat-tile grid). Pure markup —
 * no dataset, no drag, no front-lane marker; `buildCard()` below layers
 * those battlefield concerns on top. Shared with ui/team.js (Phase 10.8) so
 * the Setup Team panel renders the same cards the battlefield does.
 * @param {object} u a unit (live battle unit, or any display lane shaped the
 *   same way: hp/maxHp/name/cls/element/atk range/matk range/spd/alive,
 *   optionally rank + equipment[]/equipmentCount + runes[]/runeCount, and
 *   optionally `statTone` — `{atk?, spd?, hp?}`, each `'up'`/`'down'`, to
 *   color that stat's value green/orange (display-only, e.g. a staged-gear
 *   preview; absent for every battlefield caller)
 * @param {string} posLabel badge text, e.g. "A1"/"B2" — pass "" for none
 */
export function unitCardEl(u, posLabel) {
  const card = document.createElement("div");
  card.className = "unit-card";
  if (!u.alive) card.classList.add("dead");
  if (u.rank != null) card.classList.add(`rank-${String(u.rank).toLowerCase()}`);

  const tone = (key) => (u.statTone?.[key] === "up" ? " tone-up" : u.statTone?.[key] === "down" ? " tone-down" : "");
  const ratio = u.hp / u.maxHp;
  const runeCount = u.runes?.length ?? u.runeCount ?? 0;
  const equipCount = u.equipment?.length ?? u.equipmentCount ?? 0;
  // Display-only "power" number (Phase 10.9) — the same powerScore() the
  // rank badge sits under; never sent anywhere. Battle/display lanes both
  // already carry the deriveStats() fields powerScore() reads.
  const rankBlock = u.rank != null
    ? `<span class="unit-rank-badge">${u.rank}</span><span class="unit-rank-power">${powerScore(u)}</span>`
    : "";
  const nameLen = (u.name || "").length;
  const nameSizeClass = nameLen > 18 ? "name-xxs" : nameLen > 14 ? "name-xs" : nameLen > 10 ? "name-sm" : "";

  card.innerHTML = `
    <div class="unit-portrait-top"><div class="unit-status-row"></div></div>
    <div class="unit-plate">
      <span class="badge-pos">${posLabel}</span>
      <span class="front-flag">FRONT</span>
      <div class="unit-head">
        <div class="unit-class">
          <div class="unit-class-icon"></div>
          ${elementLabel(u.element)}
        </div>
        <div class="unit-name${nameSizeClass ? " " + nameSizeClass : ""}">${u.name}</div>
        <div class="unit-rank">${rankBlock}</div>
      </div>
      <div class="hp-wrap">
        <div class="hp-top">
          <span class="lbl">❤️ HP</span>
          <span class="val${tone("hp")}"><span class="hp-now">${Math.max(0, Math.round(u.hp))}</span>/${u.maxHp}</span>
        </div>
        <div class="hp-bar"><div class="hp-fill" style="width:${ratio * 100}%;background:${hpColor(ratio)}"></div></div>
      </div>
      <div class="stats">
        <div class="stat" title="Attack"><span class="s-ico">⚔️</span><span class="s-val${tone("atk")}">${atkLabel(u)}</span></div>
        <div class="stat" title="Speed"><span class="s-ico">⚡</span><span class="s-val${tone("spd")}">${u.spd}</span></div>
        <div class="stat" title="Runes"><span class="s-ico">🔮</span><span class="s-val">${runeCount}</span></div>
        <div class="stat" title="Equipment"><span class="s-ico">🛡️</span><span class="s-val">${equipCount}</span></div>
      </div>
    </div>
  `;

  // Mount the unit's portrait (or emoji fallback) above the info plate. The
  // card is built on the front lane idle by default; combat can swap actions.
  card.querySelector(".unit-portrait-top").appendChild(spriteEl(u, u.alive ? "idle" : "dead"));
  card.querySelector(".unit-class-icon").appendChild(classIconEl(u.cls));
  fillStatusRow(card.querySelector(".unit-status-row"), u.statuses ?? []);
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

/**
 * Build the element label under the class-icon tile (Phase 10.9 refined
 * 2026-07-10) — the element's capitalized name, colored per element via an
 * `element-<name>` modifier class; unknown/missing renders the raw value
 * (or nothing) in the default muted color, no modifier class.
 */
const KNOWN_ELEMENTS = ["fire", "wind", "water", "earth", "holy", "dark"];
function elementLabel(el) {
  const lower = String(el || "").toLowerCase();
  if (KNOWN_ELEMENTS.includes(lower)) {
    const cap = lower[0].toUpperCase() + lower.slice(1);
    return `<span class="unit-element element-${lower}">${cap}</span>`;
  }
  return `<span class="unit-element">${el || ""}</span>`;
}

/**
 * Build the class-icon tile's `<img>` (Phase 10.9) — its `title`/`alt` is
 * the class name (a native tooltip replaces the old text label). Resolves
 * the PNG's base filename via the classes MASTER TABLE's `icon` column
 * (Phase 10.12 follow-up, server-loaded into `state.classes` at init via
 * GET /api/trainer/classes — admin-editable live, ui/admin.js's 🎭 Classes
 * tab), falling back to the class name lowercased when that's absent (a
 * class missing an explicit icon, or one not in state.classes at all — e.g.
 * an admin-created live class read before a refresh), then to a single
 * fallback, `default.png`, if that art is missing too — so a user can drop
 * in replacement art under public/icons/classes/ without touching code (see
 * that dir's README.md) — same public-asset path style as ui/sprite.js's
 * `/sprites/...` references. Exported (Phase 10.16) so ui/monsterSetup.js's
 * detail header can build the same class-icon tile the battlefield card
 * does, without duplicating the lookup chain.
 */
export function classIconEl(cls) {
  const base = state.classes[cls]?.icon || String(cls || "").toLowerCase();
  const img = document.createElement("img");
  img.className = "unit-class-icon-img";
  img.alt = cls || "";
  img.title = cls || "";
  img.draggable = false;
  img.src = `/icons/classes/${base}.png`;
  img.onerror = () => {
    img.onerror = null; // guard: a missing default.png must not loop
    img.src = "/icons/classes/default.png";
  };
  return img;
}

/**
 * (Re)fill a `.unit-status-row` element from a statuses array (status-id
 * strings, left->right in the order gained). Resolves each PNG's base
 * filename via `STATUS_ICONS[id]` (the authoritative map), falling back to
 * the status id itself for a status not in the map, then to a single
 * fallback, `default.png`, if that art is missing too — same lookup chain
 * as `classIconEl()` (see public/icons/statuses/README.md).
 */
function fillStatusRow(row, statuses) {
  if (!row) return;
  row.innerHTML = "";
  for (const id of statuses) {
    const base = STATUS_ICONS[id] || id;
    const img = document.createElement("img");
    img.className = "status-icon-img";
    img.alt = STATUSES[id]?.label || id;
    img.title = STATUSES[id]?.label || id;
    img.draggable = false;
    img.src = `/icons/statuses/${base}.png`;
    img.onerror = () => {
      img.onerror = null; // guard: a missing default.png must not loop
      img.src = "/icons/statuses/default.png";
    };
    row.appendChild(img);
  }
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

/** Update a unit's on-card status-icon row (top of the portrait, left→right in order gained). */
export function updateCardStatuses(unit) {
  const card = cardEl(unit.id);
  if (!card) return;
  fillStatusRow(card.querySelector(".unit-status-row"), unit.statuses);
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
