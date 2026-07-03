// Inventory panel (Phase 7.1 client half): a read-only look at everything a
// trainer owns — item stacks, equipment (bag + equipped), and runes. Pure
// presentation over GET /api/trainer/inventory, re-fetched every time the
// panel opens (no local mutation — nothing here writes yet; acquisition is
// the admin console's Grant control until Phase 7.4, equip/enhance UX is
// 7.2+). Same tab-panel shell as the Arena panel (ui/pvp.js).

import { fetchInventory } from "../services/content.js";

const TABS = [
  ["items", "🧰 Items"],
  ["equipment", "⚔ Equipment"],
  ["runes", "🔮 Runes"],
];

const KIND_LABEL = { material: "Material", consumable: "Consumable" };

let els = null;
let tab = "items";
let data = null; // last fetchInventory() result

export function initInventory() {
  els = {
    btn: document.getElementById("inventoryBtn"),
    panel: document.getElementById("inventoryPanel"),
    tabs: document.getElementById("inventoryTabs"),
    msgs: document.getElementById("inventoryMsgs"),
    body: document.getElementById("inventoryBody"),
  };
  els.btn.addEventListener("click", toggle);
}

async function toggle() {
  const opening = els.panel.hidden;
  els.panel.hidden = !opening;
  els.btn.textContent = opening ? "🎒 Close Inventory" : "🎒 Inventory";
  if (opening) await refresh();
}

/** Re-read the whole inventory (cheap, one endpoint) and re-render. */
async function refresh() {
  els.msgs.innerHTML = "";
  renderTabs();
  try {
    data = await fetchInventory();
  } catch (e) {
    data = null;
    pushMsg(`Could not load the inventory: ${e.message}`, true);
  }
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

function badge(text) {
  return el("span", "inv-badge", text);
}

// ---------- shell ----------

function renderTabs() {
  els.tabs.innerHTML = "";
  for (const [id, label] of TABS) {
    els.tabs.appendChild(button(label, "inv-tab" + (id === tab ? " active" : ""), () => selectTab(id)));
  }
}

function selectTab(id) {
  if (id === tab) return;
  tab = id;
  renderTabs();
  renderBody();
}

function renderBody() {
  els.body.innerHTML = "";
  if (!data) return;
  ({ items: itemsTab, equipment: equipmentTab, runes: runesTab })[tab]();
}

function emptyState(text) {
  els.body.appendChild(el("p", "inv-hint", text));
}

// ---------- items tab ----------

function itemsTab() {
  if (data.items.length === 0) {
    return emptyState("Nothing here yet — items arrive in later phases (or via an admin grant).");
  }
  for (const it of data.items) {
    const row = el("div", "inv-row");
    const id = el("div", "inv-id");
    const txt = el("span");
    txt.append(el("b", null, it.name), el("small", null, it.description || "—"));
    id.append(txt);
    const side = el("div", "inv-actions");
    side.append(badge(KIND_LABEL[it.kind] ?? it.kind), el("span", "inv-qty", `×${it.qty}`));
    row.append(id, side);
    els.body.appendChild(row);
  }
}

// ---------- equipment tab ----------

function equipmentTab() {
  const rows = [...data.equipment.trainer, ...data.equipment.monster];
  if (rows.length === 0) {
    return emptyState("No equipment yet — equip/enhance arrives in Phase 7.2.");
  }
  for (const e of rows) {
    const row = el("div", "inv-row");
    const id = el("div", "inv-id");
    const txt = el("span");
    txt.append(el("b", null, e.name), el("small", null, e.description || "—"));
    id.append(txt);
    const side = el("div", "inv-actions");
    side.append(badge(`${e.domain} · ${e.slot}`));
    if (e.enhance) side.append(badge(`+${e.enhanceLevel}`));
    side.append(el("span", "inv-loc", equipmentLocation(e)));
    row.append(id, side);
    els.body.appendChild(row);
  }
}

function equipmentLocation(e) {
  if (e.domain === "trainer") return e.equippedSlot ? `Equipped: ${e.equippedSlot}` : "In bag";
  return e.monsterId != null ? `Monster #${e.monsterId}` : "In bag";
}

// ---------- runes tab ----------

function runesTab() {
  if (data.runes.length === 0) {
    return emptyState("No runes yet — socketing arrives in Phase 7.3.");
  }
  for (const r of data.runes) {
    const row = el("div", "inv-row");
    const id = el("div", "inv-id");
    const txt = el("span");
    txt.append(el("b", null, r.name), el("small", null, r.description || "—"));
    id.append(txt);
    const side = el("div", "inv-actions");
    side.append(badge(`Lv ${r.level}`), el("span", "inv-charges", `${r.chargesLeft}/${r.maxCharges}`));
    if (r.broken) side.append(badge("broken"));
    side.append(el("span", "inv-loc", r.monsterId != null ? `Monster #${r.monsterId}` : "In bag"));
    row.append(id, side);
    els.body.appendChild(row);
  }
}
