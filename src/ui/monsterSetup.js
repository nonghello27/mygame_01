// Setup Monster panel (Phase 10.6) — the monster-centric complement to the
// item-centric 🎒 Inventory panel: pick ONE owned monster, see and change
// everything seated on it (monster-domain equipment + socketed runes). Pure
// display + action over the SAME endpoints ui/inventory.js uses
// (fetchInventory read, equipMonsterEquipment/socketRune writes).
//
// Phase 10.10: the text-chip picker is now a horizontally scrollable row of
// the shared battlefield-style unit cards (board.js's unitCardEl(), the same
// widget ui/partyPicker.js hosts), and gear/rune changes are STAGED locally
// (keyed by piece id, not by which monster is currently selected) rather than
// fired immediately — a Save button applies every staged change over the
// existing endpoints in one pass, unequips/unsockets first so slots/capacity
// are free before the equips/sockets that follow.
//
// Phase 10.10 round 2: the picker's cards now show GEAR-EFFECTIVE stats (the
// monster's saved equipment folded in via applyGearStats(), display-only —
// mirrors shared/engine/resolve.js's perm_stat math exactly) with a
// statTone preview while a change is staged, and equipmentCount/runeCount
// are recomputed from the projected (staged) state rather than the stale
// loadFarm() roster read; the Bag section also grew an Items | Equipment |
// Runes tab bar instead of always mixing equipment+rune rows together.

import { fetchInventory, loadFarm, equipMonsterEquipment, socketRune } from "../services/content.js";
import { registerView } from "./views.js";
import { unitCardEl, classIconEl } from "./board.js";
import { goodIconEl } from "./goodsMedia.js";
import { deriveStats, applyGearStats, powerScore } from "../../shared/rules/formulas.js";

// Same known-element list as board.js's elementLabel() — kept local rather
// than exported/imported since it's a one-line lookup, not real logic.
const KNOWN_ELEMENTS = ["fire", "wind", "water", "earth", "holy", "dark"];

let els = null;
let data = null;          // last fetchInventory() result
let monsters = [];        // last loadFarm().monsters
let selectedId = null;    // selected monster id, or null
let bagTab = "equipment"; // Bag section's active tab: "items" | "equipment" | "runes"

// Staged gear changes, keyed by piece instance id -> target monsterId
// (number) or null (unequip/unsocket to bag). A piece's PROJECTED location
// is the map's override if present, else its server monsterId; an override
// that lands back on the server value is deleted (no-op change) rather than
// kept as a no-op entry — see stageEquipment()/stageRune() below.
let pendingEquipment = new Map();
let pendingRunes = new Map();
let saving = false;       // true while doSave()'s sequential apply is in flight

export function initMonsterSetup() {
  els = {
    btn: document.getElementById("monsterSetupBtn"),
    panel: document.getElementById("monsterSetupPanel"),
    msgs: document.getElementById("monsterSetupMsgs"),
    body: document.getElementById("monsterSetupBody"),
  };
  registerView("monsterSetup", { button: els.btn, el: els.panel, onShow: refresh });
}

/** Re-read the inventory + roster, keep (or drop) the current selection, and
 *  re-render. Never throws — a failed read just leaves the body empty.
 *  Staged choices are session-local (never sent until Save) — a re-open of
 *  the panel starts clean rather than trying to reconcile them against a
 *  fresh read. */
async function refresh() {
  els.msgs.innerHTML = "";
  pendingEquipment = new Map();
  pendingRunes = new Map();
  saving = false;
  bagTab = "equipment";
  try {
    const [inv, farm] = await Promise.all([fetchInventory(), loadFarm()]);
    data = inv;
    monsters = farm.monsters;
  } catch (e) {
    data = null;
    pushMsg(`Could not load the roster/inventory: ${e.message}`, true);
  }
  if (selectedId != null && !monsters.some((m) => m.id === selectedId)) selectedId = null;
  if (selectedId == null && monsters.length > 0) selectedId = monsters[0].id;
  renderBody();
}

function pushMsg(text, isError = false) {
  const p = document.createElement("p");
  p.textContent = text;
  p.classList.toggle("err", isError);
  els.msgs.appendChild(p);
}

// ---------- tiny DOM helpers ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text, cls, onClick) {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function badge(text, extraCls) {
  return el("span", extraCls ? `ms-badge ${extraCls}` : "ms-badge", text);
}

/** A display lane for one roster monster: derived stats at full HP, alive,
 *  gear-effective off the monster's EQUIPPED equipment AND socketed runes
 *  (both the SAVED, server-side state and any STAGED change) — exactly what
 *  the battlefield card markup expects, plus a `statTone` highlighting any
 *  stat the staged changes move. Broken runes are excluded — they can't be
 *  socketed and never fire. Display only, never sent anywhere
 *  (ui/partyPicker.js's plainer identical-shape helper, Phase 10.9, has no
 *  gear/staging concept to preview). */
function laneView(m) {
  const base = deriveStats(m.base, m.attrs);
  const savedGear = data.equipment.monster.filter((e) => e.monsterId === m.id);
  const projectedGear = data.equipment.monster.filter((e) => projectedEquipmentMonsterId(e) === m.id);
  const savedRunes = data.runes.filter((r) => !r.broken && r.monsterId === m.id);
  const projectedRunes = data.runes.filter((r) => !r.broken && projectedRuneMonsterId(r) === m.id);

  const baseline = applyGearStats(base, [...savedGear, ...savedRunes]);
  const proj = applyGearStats(base, [...projectedGear, ...projectedRunes]);

  const statTone = {};
  const baseAtk = baseline.atkMin + baseline.atkMax;
  const projAtk = proj.atkMin + proj.atkMax;
  if (projAtk !== baseAtk) statTone.atk = projAtk > baseAtk ? "up" : "down";
  if (proj.spd !== baseline.spd) statTone.spd = proj.spd > baseline.spd ? "up" : "down";
  if (proj.maxHp !== baseline.maxHp) statTone.hp = proj.maxHp > baseline.maxHp ? "up" : "down";

  return {
    ...m,
    ...proj,
    hp: proj.maxHp,
    alive: true,
    equipment: projectedGear,
    runes: projectedRunes,
    ...(Object.keys(statTone).length > 0 ? { statTone } : {}),
  };
}

// ---------- staged-change projection ----------

function projectedEquipmentMonsterId(e) {
  return pendingEquipment.has(e.id) ? pendingEquipment.get(e.id) : e.monsterId;
}

function projectedRuneMonsterId(r) {
  return pendingRunes.has(r.id) ? pendingRunes.get(r.id) : r.monsterId;
}

/** Stage (or clear) an equipment piece's target monster. Landing back on the
 *  server's own monsterId deletes the override rather than keeping a no-op
 *  entry, so the pending count only ever reflects real changes. */
function stageEquipment(e, targetMonsterId) {
  if (targetMonsterId === e.monsterId) pendingEquipment.delete(e.id);
  else pendingEquipment.set(e.id, targetMonsterId);
  renderBody();
}

function stageRune(r, targetMonsterId) {
  if (targetMonsterId === r.monsterId) pendingRunes.delete(r.id);
  else pendingRunes.set(r.id, targetMonsterId);
  renderBody();
}

// ---------- rendering ----------

function renderBody() {
  // Re-render must not lose the player's scroll position in the picker
  // (Phase 10.16 playtest fix) — clicking a card, staging a change,
  // switching a bag tab, or saving all rebuild this whole body.
  const scrollLeft = els.body.querySelector(".ms-cards")?.scrollLeft ?? 0;
  els.body.innerHTML = "";
  if (!data) return;

  const picker = pickerRow();
  els.body.appendChild(picker);
  picker.scrollLeft = scrollLeft;

  if (monsters.length === 0) {
    els.body.appendChild(el("p", "ms-hint", "No monsters yet — win or summon one first."));
    return;
  }

  const m = monsters.find((mm) => mm.id === selectedId);
  if (!m) return; // shouldn't happen — refresh() keeps selectedId valid whenever the roster is non-empty

  els.body.appendChild(headerRow(m));
  els.body.appendChild(equippedSection(m));
  els.body.appendChild(bagSection(m));
  els.body.appendChild(saveBar());
}

/** Horizontally scrollable row of battlefield-style unit cards (Phase
 *  10.10) — one per owned monster, click to select. Busy monsters stay
 *  selectable: gear changes while busy are allowed today, same as before
 *  this round. */
function pickerRow() {
  const row = el("div", "ms-cards");
  for (const m of monsters) {
    const card = unitCardEl(laneView(m), "");
    if (m.id === selectedId) card.classList.add("ms-card-active");
    card.addEventListener("click", () => {
      selectedId = m.id;
      renderBody();
    });
    row.appendChild(card);
  }
  return row;
}

/** Element-name label under/next to the name, colored via board.css's
 *  `.unit-element.element-<name>` classes (Phase 10.16) — the exact
 *  battlefield-card mechanism, kept in sync automatically since the color
 *  variables live in that one shared stylesheet. */
function elementLabelEl(element) {
  const lower = String(element || "").toLowerCase();
  if (KNOWN_ELEMENTS.includes(lower)) {
    const cap = lower[0].toUpperCase() + lower.slice(1);
    return el("span", `unit-element element-${lower}`, cap);
  }
  return el("span", "unit-element", element || "");
}

/**
 * Detail header (Phase 10.16 redesign) — the unit-card design language
 * instead of the old raw-emoji/plain-text style: a class-icon tile
 * (board.js's classIconEl(), same lookup chain the battlefield uses), the
 * name with a colored element label, a rank badge + powerScore() when the
 * monster has a rank (same `.unit-rank-badge`/`.unit-rank-power` classes and
 * rank->color mapping unitCardEl() uses — mirrored onto `.ms-head` itself
 * via a `.rank-<tier>` modifier class, since this header isn't a battlefield
 * unit-card), the attrs line, and a derived-stats badge row (mirrors
 * partyPicker.js's team-detail-badge row). Stats are GEAR-EFFECTIVE — the
 * SAME laneView(m) the picker cards already use, staged changes folded in,
 * so this always reflects the latest projected state. */
function headerRow(m) {
  const view = laneView(m);
  const head = el("div", "ms-head");
  if (view.rank != null) head.classList.add(`rank-${String(view.rank).toLowerCase()}`);

  const iconTile = el("div", "unit-class-icon ms-head-icon");
  iconTile.appendChild(classIconEl(m.cls));
  head.appendChild(iconTile);

  const info = el("div", "ms-head-info");

  const nameRow = el("div", "ms-head-name-row");
  nameRow.append(el("b", "ms-head-name", m.name), elementLabelEl(m.element));
  info.appendChild(nameRow);

  if (view.rank != null) {
    const rankRow = el("div", "ms-head-rank");
    rankRow.append(
      el("span", "unit-rank-badge", String(view.rank)),
      el("span", "unit-rank-power", String(powerScore(view))),
    );
    info.appendChild(rankRow);
  }

  const a = m.attrs || {};
  info.append(el("div", "ms-attrs", `STR ${a.str ?? 0} · AGI ${a.agi ?? 0} · VIT ${a.vit ?? 0} · INT ${a.int ?? 0} · DEX ${a.dex ?? 0}`));

  const stats = el("div", "ms-head-stats");
  stats.append(
    badge(`HP ${view.maxHp}`),
    badge(`ATK ${view.atkMin}–${view.atkMax}`),
    badge(`MATK ${view.matkMin}–${view.matkMax}`),
    badge(`SPD ${view.spd}`),
    badge(`CRIT ${view.crit}%`),
    badge(`EVA ${view.evade}%`),
    badge(`ACC ${view.acc}%`),
  );
  info.appendChild(stats);

  head.appendChild(info);
  return head;
}

function equippedSection(m) {
  const section = el("div", "ms-section");
  section.appendChild(el("h4", null, "Equipped"));

  const equipment = data.equipment.monster.filter((e) => projectedEquipmentMonsterId(e) === m.id);
  const runes = data.runes.filter((r) => projectedRuneMonsterId(r) === m.id);

  if (equipment.length === 0 && runes.length === 0) {
    section.appendChild(el("p", "ms-hint", "Nothing equipped yet."));
    return section;
  }

  for (const e of equipment) section.appendChild(equippedEquipmentRow(e));
  for (const r of runes) section.appendChild(equippedRuneRow(r));
  return section;
}

function equippedEquipmentRow(e) {
  const row = el("div", "ms-row");
  const id = el("div", "ms-id");
  const txt = el("span");
  txt.append(el("b", null, e.name), el("small", null, e.description || "—"));
  id.append(goodIconEl("equipment", e), txt);

  const side = el("div", "ms-actions");
  side.append(badge(e.slot));
  if (e.enhance) side.append(badge(`+${e.enhanceLevel}`));
  if (pendingEquipment.has(e.id)) side.append(badge("pending", "ms-pending"));
  const unequipBtn = button("Unequip", "btn ghost ms-small", () => stageEquipment(e, null));
  side.appendChild(unequipBtn);

  row.append(id, side);
  return row;
}

function equippedRuneRow(r) {
  const row = el("div", "ms-row");
  const id = el("div", "ms-id");
  const txt = el("span");
  txt.append(el("b", null, r.name), el("small", null, r.description || "—"));
  id.append(goodIconEl("runes", r), txt);

  const side = el("div", "ms-actions");
  side.append(badge(`Lv ${r.level}`), el("span", "ms-charges", `${r.chargesLeft}/${r.maxCharges}`));
  if (r.broken) side.append(badge("BROKEN", "ms-broken"));
  if (pendingRunes.has(r.id)) side.append(badge("pending", "ms-pending"));
  const unsocketBtn = button("Unsocket", "btn ghost ms-small", () => stageRune(r, null));
  side.appendChild(unsocketBtn);

  row.append(id, side);
  return row;
}

const BAG_TABS = [
  ["items", "Items"],
  ["equipment", "Equipment"],
  ["runes", "Runes"],
];

/** Bag section (Phase 10.10 round 2): an Items | Equipment | Runes tab bar
 *  over the bag's contents — items are display-only (they're used from the
 *  🎒 Inventory panel, not equipped), equipment/runes keep their existing
 *  Equip/Socket rows. */
function bagSection(m) {
  const section = el("div", "ms-section");
  section.appendChild(el("h4", null, "Bag"));

  const tabs = el("div", "ms-tabs");
  for (const [id, label] of BAG_TABS) {
    tabs.appendChild(button(label, "ms-tab" + (id === bagTab ? " active" : ""), () => {
      bagTab = id;
      renderBody();
    }));
  }
  section.appendChild(tabs);

  section.appendChild(bagTab === "items" ? bagItemsList() : bagTab === "equipment" ? bagEquipmentList(m) : bagRunesList(m));
  return section;
}

/** Items tab: display-only rows (name/description/qty) — items can't be
 *  equipped, they're consumed from the 🎒 Inventory panel. */
function bagItemsList() {
  const list = el("div", "ms-bag-list");
  list.appendChild(el("p", "ms-hint", "Items can't be equipped — use them from the 🎒 Inventory panel."));
  if (data.items.length === 0) {
    list.appendChild(el("p", "ms-hint", "No items."));
    return list;
  }
  for (const it of data.items) {
    const row = el("div", "ms-row");
    const id = el("div", "ms-id");
    const txt = el("span");
    txt.append(el("b", null, it.name), el("small", null, it.description || "—"));
    id.append(goodIconEl("items", it), txt);
    const side = el("div", "ms-actions");
    side.append(el("span", "ms-charges", `×${it.qty}`));
    row.append(id, side);
    list.appendChild(row);
  }
  return list;
}

function bagEquipmentList(m) {
  const list = el("div", "ms-bag-list");
  const equipment = data.equipment.monster.filter((e) => projectedEquipmentMonsterId(e) == null);
  if (equipment.length === 0) {
    list.appendChild(el("p", "ms-hint", "No monster gear in the bag."));
    return list;
  }
  for (const e of equipment) list.appendChild(bagEquipmentRow(e, m));
  return list;
}

function bagRunesList(m) {
  const list = el("div", "ms-bag-list");
  const runes = data.runes.filter((r) => projectedRuneMonsterId(r) == null);
  if (runes.length === 0) {
    list.appendChild(el("p", "ms-hint", "No runes in the bag."));
    return list;
  }
  for (const r of runes) list.appendChild(bagRuneRow(r, m));
  return list;
}

function bagEquipmentRow(e, m) {
  const row = el("div", "ms-row");
  const id = el("div", "ms-id");
  const txt = el("span");
  txt.append(el("b", null, e.name), el("small", null, e.description || "—"));
  id.append(goodIconEl("equipment", e), txt);

  const side = el("div", "ms-actions");
  side.append(badge(e.slot));
  if (e.enhance) side.append(badge(`+${e.enhanceLevel}`));
  if (pendingEquipment.has(e.id)) side.append(badge("pending", "ms-pending"));
  const equipBtn = button("Equip", "btn ghost ms-small", () => stageEquipment(e, m.id));
  side.appendChild(equipBtn);

  row.append(id, side);
  return row;
}

function bagRuneRow(r, m) {
  const row = el("div", "ms-row");
  const id = el("div", "ms-id");
  const txt = el("span");
  txt.append(el("b", null, r.name), el("small", null, r.description || "—"));
  id.append(goodIconEl("runes", r), txt);

  const side = el("div", "ms-actions");
  side.append(badge(`Lv ${r.level}`), el("span", "ms-charges", `${r.chargesLeft}/${r.maxCharges}`));

  if (r.broken) {
    side.append(badge("BROKEN", "ms-broken"));
    row.append(id, side);
    row.appendChild(el("small", "ms-hint", "repair it in the 🎒 Inventory panel"));
    return row;
  }

  if (pendingRunes.has(r.id)) side.append(badge("pending", "ms-pending"));
  // No client-side rune-slot-capacity precheck here — the server 409s "no
  // free rune slots" (or "repair it first") at Save time, same as it always
  // has (CLAUDE.md §1.1); doSave() below surfaces that message per-piece.
  const socketBtn = button("Socket", "btn ghost ms-small", () => stageRune(r, m.id));
  side.appendChild(socketBtn);

  row.append(id, side);
  return row;
}

// ---------- save bar ----------

function saveBar() {
  const bar = el("div", "ms-savebar");
  const n = pendingEquipment.size + pendingRunes.size;

  const saveBtn = button(saving ? "Saving…" : `Save changes (${n})`, "btn primary", doSave);
  saveBtn.disabled = n === 0 || saving;
  bar.appendChild(saveBtn);

  const discardBtn = button("Discard", "btn ghost", () => {
    pendingEquipment = new Map();
    pendingRunes = new Map();
    renderBody();
  });
  discardBtn.disabled = n === 0 || saving;
  bar.appendChild(discardBtn);

  return bar;
}

/** Every staged (id -> target) entry, unequip/unsocket ops (target === null)
 *  first so slots/capacity are freed before the equip/socket ops that fill
 *  them — equipping into an occupied slot DOES auto-return the previous
 *  occupant in the same server statement (Phase 7.2), but going null-first
 *  here still keeps the applied order matching what the player staged. */
function buildOps() {
  const ops = [];
  for (const [id, target] of pendingEquipment) ops.push({ kind: "equipment", id, target });
  for (const [id, target] of pendingRunes) ops.push({ kind: "rune", id, target });
  ops.sort((a, b) => (a.target == null ? 0 : 1) - (b.target == null ? 0 : 1));
  return ops;
}

function pieceName(op) {
  const list = op.kind === "equipment" ? data.equipment.monster : data.runes;
  return list.find((p) => p.id === op.id)?.name ?? `${op.kind} #${op.id}`;
}

/**
 * Apply every staged change sequentially over the existing endpoints. On a
 * failed call: stop immediately, leave that op (and everything after it)
 * staged so the player can retry or discard, and surface the piece's name
 * plus the server's message. On full success: clear both maps and report
 * how many changes landed.
 */
async function doSave() {
  const ops = buildOps();
  if (ops.length === 0) return;

  saving = true;
  els.msgs.innerHTML = "";
  renderBody();

  for (const op of ops) {
    const name = pieceName(op);
    try {
      data = op.kind === "equipment"
        ? await equipMonsterEquipment(op.id, op.target)
        : await socketRune(op.id, op.target);
      if (op.kind === "equipment") pendingEquipment.delete(op.id);
      else pendingRunes.delete(op.id);
    } catch (e) {
      pushMsg(`${name}: ${e.message}`, true);
      saving = false;
      renderBody();
      return;
    }
  }

  saving = false;
  pushMsg(`Saved ${ops.length} change(s).`);
  renderBody();
}
