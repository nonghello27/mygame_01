// Setup Monster panel (Phase 10.6) — the monster-centric complement to the
// item-centric 🎒 Inventory panel: pick ONE owned monster, see and change
// everything seated on it (monster-domain equipment + socketed runes). Pure
// display + action over the SAME endpoints ui/inventory.js uses
// (fetchInventory read, equipMonsterEquipment/socketRune writes) — every
// action re-renders from the response the server hands back; trainer-domain
// gear stays in the Inventory panel (it isn't a monster's).

import { fetchInventory, loadFarm, equipMonsterEquipment, socketRune } from "../services/content.js";
import { registerView } from "./views.js";

let els = null;
let data = null;          // last fetchInventory() result
let monsters = [];        // last loadFarm().monsters
let selectedId = null;    // selected monster id, or null

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
 *  re-render. Never throws — a failed read just leaves the body empty. */
async function refresh() {
  els.msgs.innerHTML = "";
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

// ---------- rendering ----------

function renderBody() {
  els.body.innerHTML = "";
  if (!data) return;

  els.body.appendChild(pickerRow());

  if (monsters.length === 0) {
    els.body.appendChild(el("p", "ms-hint", "No monsters yet — win or summon one first."));
    return;
  }

  const m = monsters.find((mm) => mm.id === selectedId);
  if (!m) return; // shouldn't happen — refresh() keeps selectedId valid whenever the roster is non-empty

  els.body.appendChild(headerRow(m));
  els.body.appendChild(equippedSection(m));
  els.body.appendChild(bagSection(m));
}

function pickerRow() {
  const row = el("div", "ms-picker");
  for (const m of monsters) {
    const chip = button(`${m.emoji || "❔"} ${m.name}`, "ms-chip" + (m.id === selectedId ? " active" : ""), () => {
      selectedId = m.id;
      renderBody();
    });
    row.appendChild(chip);
  }
  return row;
}

function headerRow(m) {
  const head = el("div", "ms-head");
  head.append(el("span", "ms-head-emoji", m.emoji || "❔"));
  const info = el("div");
  info.append(el("b", null, m.name), el("span", "ms-head-sub", ` ${m.cls} · ${m.element}`));
  const a = m.attrs || {};
  info.append(el("div", "ms-attrs", `STR ${a.str ?? 0} · AGI ${a.agi ?? 0} · VIT ${a.vit ?? 0} · INT ${a.int ?? 0} · DEX ${a.dex ?? 0}`));
  head.appendChild(info);
  return head;
}

function equippedSection(m) {
  const section = el("div", "ms-section");
  section.appendChild(el("h4", null, "Equipped"));

  const equipment = data.equipment.monster.filter((e) => e.monsterId === m.id);
  const runes = data.runes.filter((r) => r.monsterId === m.id);

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
  id.append(txt);

  const side = el("div", "ms-actions");
  side.append(badge(e.slot));
  if (e.enhance) side.append(badge(`+${e.enhanceLevel}`));
  const unequipBtn = button("Unequip", "btn ghost ms-small", async () => {
    await runAction(unequipBtn, () => equipMonsterEquipment(e.id, null));
  });
  side.appendChild(unequipBtn);

  row.append(id, side);
  return row;
}

function equippedRuneRow(r) {
  const row = el("div", "ms-row");
  const id = el("div", "ms-id");
  const txt = el("span");
  txt.append(el("b", null, r.name), el("small", null, r.description || "—"));
  id.append(txt);

  const side = el("div", "ms-actions");
  side.append(badge(`Lv ${r.level}`), el("span", "ms-charges", `${r.chargesLeft}/${r.maxCharges}`));
  if (r.broken) side.append(badge("BROKEN", "ms-broken"));
  const unsocketBtn = button("Unsocket", "btn ghost ms-small", async () => {
    await runAction(unsocketBtn, () => socketRune(r.id, null));
  });
  side.appendChild(unsocketBtn);

  row.append(id, side);
  return row;
}

function bagSection(m) {
  const section = el("div", "ms-section");
  section.appendChild(el("h4", null, "Bag"));

  const equipment = data.equipment.monster.filter((e) => e.monsterId == null);
  const runes = data.runes.filter((r) => r.monsterId == null);

  if (equipment.length === 0 && runes.length === 0) {
    section.appendChild(el("p", "ms-hint", "Bag is empty — no monster-domain gear or runes to equip."));
    return section;
  }

  for (const e of equipment) section.appendChild(bagEquipmentRow(e, m));
  for (const r of runes) section.appendChild(bagRuneRow(r, m));
  return section;
}

function bagEquipmentRow(e, m) {
  const row = el("div", "ms-row");
  const id = el("div", "ms-id");
  const txt = el("span");
  txt.append(el("b", null, e.name), el("small", null, e.description || "—"));
  id.append(txt);

  const side = el("div", "ms-actions");
  side.append(badge(e.slot));
  if (e.enhance) side.append(badge(`+${e.enhanceLevel}`));
  // Equipping into an occupied slot auto-returns the previous occupant to
  // the bag in the same statement — server behavior, Phase 7.2.
  const equipBtn = button("Equip", "btn ghost ms-small", async () => {
    await runAction(equipBtn, () => equipMonsterEquipment(e.id, m.id));
  });
  side.appendChild(equipBtn);

  row.append(id, side);
  return row;
}

function bagRuneRow(r, m) {
  const row = el("div", "ms-row");
  const id = el("div", "ms-id");
  const txt = el("span");
  txt.append(el("b", null, r.name), el("small", null, r.description || "—"));
  id.append(txt);

  const side = el("div", "ms-actions");
  side.append(badge(`Lv ${r.level}`), el("span", "ms-charges", `${r.chargesLeft}/${r.maxCharges}`));

  if (r.broken) {
    side.append(badge("BROKEN", "ms-broken"));
    row.append(id, side);
    row.appendChild(el("small", "ms-hint", "repair it in the 🎒 Inventory panel"));
    return row;
  }

  // The server enforces the species' rune_slots capacity and 409s "no free
  // rune slots" — surface its message, don't pre-check.
  const socketBtn = button("Socket", "btn ghost ms-small", async () => {
    await runAction(socketBtn, () => socketRune(r.id, m.id));
  });
  side.appendChild(socketBtn);

  row.append(id, side);
  return row;
}

/**
 * Run an equip/socket action: disable the button, apply the refreshed
 * inventory (both endpoints return it), and surface server errors at the
 * panel level (same pattern as inventory.js's runAction). No gold is spent
 * here, so there's no gold chip to refresh.
 */
async function runAction(btn, action) {
  btn.disabled = true;
  els.msgs.innerHTML = "";
  try {
    data = await action();
    renderBody();
  } catch (e) {
    pushMsg(e.message, true);
    btn.disabled = false;
  }
}
