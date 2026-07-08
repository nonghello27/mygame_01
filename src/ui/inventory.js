// Inventory panel (Phase 7.1 read + Phase 7.2 equip/enhance + Phase 7.3
// socket/repair): everything a trainer owns — item stacks, equipment (bag +
// equipped), and runes — plus the controls to equip/unequip, enhance,
// socket/unsocket, and repair. Pure presentation + action layer: all state
// (including gold, enhance cost curves, and repair costs) comes from the
// server; every action re-fetches the whole inventory from the response the
// server hands back, same round-trip precedent as the Arena panel's
// saveDefense(). Acquisition is still the admin console's Grant control
// until Phase 7.4. Same tab-panel shell as the Arena panel (ui/pvp.js).

import {
  fetchInventory, loadFarm,
  equipMonsterEquipment, equipTrainerEquipment, enhanceEquipment,
  socketRune, repairRune, sellToSystem,
} from "../services/content.js";
import { fetchMe } from "../services/auth.js";
import { showProfile } from "./auth.js";
import { registerView } from "./views.js";

const TABS = [
  ["items", "🧰 Items"],
  ["equipment", "⚔ Equipment"],
  ["runes", "🔮 Runes"],
];

const KIND_LABEL = { material: "Material", consumable: "Consumable" };

let els = null;
let tab = "items";
let data = null; // last fetchInventory() result
let monsters = []; // this trainer's roster (id/name/emoji), for the monster picker + labels

export function initInventory() {
  els = {
    btn: document.getElementById("inventoryBtn"),
    panel: document.getElementById("inventoryPanel"),
    tabs: document.getElementById("inventoryTabs"),
    msgs: document.getElementById("inventoryMsgs"),
    body: document.getElementById("inventoryBody"),
  };
  registerView("inventory", { button: els.btn, el: els.panel, onShow: refresh });
}

/** Re-read the whole inventory (cheap, one endpoint) + this trainer's
 *  roster (for the monster picker), and re-render. */
async function refresh() {
  els.msgs.innerHTML = "";
  renderTabs();
  try {
    const [inv, farm] = await Promise.all([
      fetchInventory(),
      loadFarm().catch(() => null), // roster is a label/picker nicety — degrade to ids if it fails
    ]);
    data = inv;
    monsters = farm?.monsters ?? [];
  } catch (e) {
    data = null;
    pushMsg(`Could not load the inventory: ${e.message}`, true);
  }
  renderBody();
}

/** Apply a fresh inventory payload (from an equip/enhance response) without
 *  a second round trip, and re-render the current tab in place. */
function applyInventory(inventory) {
  data = inventory;
  renderBody();
}

/** After a gold-spending action (enhance), refresh the header's gold chip
 *  the same way farm.js does after settlement — best-effort, never blocks. */
async function refreshProfile() {
  const trainer = await fetchMe();
  if (trainer) showProfile(trainer);
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
  return el("span", extraCls ? `inv-badge ${extraCls}` : "inv-badge", text);
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
    side.append(...itemSellControls(it));
    row.append(id, side);
    els.body.appendChild(row);
  }
}

/**
 * Sell-to-system control for one item stack (Phase 8): a qty picker (only
 * when the stack is more than 1) + a price-labeled Sell button, or nothing
 * when the def's `sellGold` is 0 (not sellable to the system). Confirmed via
 * a native confirm dialog, same precedent as the Adventure panel's Abandon
 * button.
 */
function itemSellControls(it) {
  if (!it.sellGold) return [];
  let qtyInput = null;
  if (it.qty > 1) {
    qtyInput = el("input", "inv-select inv-qty-input");
    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.max = String(it.qty);
    qtyInput.value = "1";
  }
  const sellBtn = button(`Sell (${it.sellGold}🪙${it.qty > 1 ? " ea" : ""})`, "btn ghost inv-small", async () => {
    const qty = qtyInput ? Math.max(1, Math.min(it.qty, Number(qtyInput.value) || 1)) : 1;
    if (!window.confirm(`Sell ${qty}× ${it.name} for ${it.sellGold * qty} 🪙?`)) return;
    await runSell(
      sellBtn,
      () => sellToSystem({ kind: "item", defId: it.defId, qty }),
      `Sold ${qty}× ${it.name} for ${it.sellGold * qty} 🪙`,
    );
  });
  return qtyInput ? [qtyInput, sellBtn] : [sellBtn];
}

// ---------- equipment tab ----------

function equipmentTab() {
  const rows = [...data.equipment.trainer, ...data.equipment.monster];
  if (rows.length === 0) {
    return emptyState("No equipment yet — grant one via the admin console, then equip/enhance it here.");
  }
  for (const e of rows) {
    els.body.appendChild(equipmentRow(e));
  }
}

function monsterName(id) {
  const m = monsters.find((mm) => mm.id === id);
  return m ? m.name : `#${id}`;
}

function equipmentLocation(e) {
  if (e.domain === "trainer") return e.equippedSlot ? `Equipped: ${e.equippedSlot}` : "In bag";
  return e.monsterId != null ? `Equipped: ${monsterName(e.monsterId)}` : "In bag";
}

function equipmentRow(e) {
  const row = el("div", "inv-row");
  const id = el("div", "inv-id");
  const txt = el("span");
  txt.append(el("b", null, e.name), el("small", null, e.description || "—"));
  id.append(txt);

  const side = el("div", "inv-actions");
  side.append(badge(`${e.domain} · ${e.slot}`));
  if (e.enhance) side.append(badge(`+${e.enhanceLevel}`));
  side.append(el("span", "inv-loc", equipmentLocation(e)));
  side.append(...equipControls(e));
  const enhanceCtl = enhanceControl(e);
  if (enhanceCtl) side.append(enhanceCtl);
  const sellCtl = equipmentSellControl(e);
  if (sellCtl) side.append(sellCtl);

  row.append(id, side);
  return row;
}

/**
 * Sell-to-system control for one equipment instance (Phase 8): only shown
 * when the piece is in the bag (unequipped) and its def's `sellGold` is
 * nonzero — an equipped piece must be unequipped first, same guard the
 * server enforces. Confirmed via a native confirm dialog.
 */
function equipmentSellControl(e) {
  if (!e.sellGold) return null;
  const equipped = e.domain === "trainer" ? e.equippedSlot != null : e.monsterId != null;
  if (equipped) return null;
  const btn = button(`Sell (${e.sellGold}🪙)`, "btn ghost inv-small", async () => {
    if (!window.confirm(`Sell ${e.name} for ${e.sellGold} 🪙?`)) return;
    await runSell(btn, () => sellToSystem({ kind: "equipment", id: e.id }), `Sold ${e.name} for ${e.sellGold} 🪙`);
  });
  return btn;
}

/** Equip/unequip controls: a monster picker + Equip/Unequip for monster-domain
 *  gear, a plain Equip/Unequip toggle for trainer-domain gear. */
function equipControls(e) {
  if (e.domain === "monster") {
    if (monsters.length === 0) return [];
    const select = el("select", "inv-select");
    for (const m of monsters) {
      const opt = el("option", null, m.name);
      opt.value = String(m.id);
      if (m.id === e.monsterId) opt.selected = true;
      select.appendChild(opt);
    }
    const equipBtn = button("Equip", "btn ghost inv-small", async () => {
      await runAction(equipBtn, () => equipMonsterEquipment(e.id, Number(select.value)));
    });
    const controls = [select, equipBtn];
    if (e.monsterId != null) {
      const unequipBtn = button("Unequip", "btn ghost inv-small", async () => {
        await runAction(unequipBtn, () => equipMonsterEquipment(e.id, null));
      });
      controls.push(unequipBtn);
    }
    return controls;
  }

  // domain === "trainer"
  const equipped = e.equippedSlot != null;
  const btn = button(equipped ? "Unequip" : "Equip", "btn ghost inv-small", async () => {
    await runAction(btn, () => equipTrainerEquipment(e.id, !equipped));
  });
  return [btn];
}

/** Enhance control: cost-labeled button, "MAX" once the curve tops out, or
 *  nothing for pieces the def marks unenhanceable (`enhance: null`). */
function enhanceControl(e) {
  if (!e.enhance) return null;
  if (e.enhanceLevel >= e.enhance.maxLevel) {
    const maxed = button("MAX", "btn ghost inv-small", () => {});
    maxed.disabled = true;
    return maxed;
  }
  const btn = button(`Enhance +1 — ${enhanceCostText(e.enhance)}`, "btn primary inv-small", async () => {
    await runAction(btn, async () => {
      const { gold, inventory } = await enhanceEquipment(e.domain, e.id);
      applyInventory(inventory);
      refreshProfile(); // fire-and-forget, mirrors gold shown by farm.js's showProfile()
      return gold;
    }, true /* already applied inside */);
  });
  return btn;
}

function enhanceCostText(curve) {
  let text = `${curve.goldPerLevel}🪙`;
  if (curve.material) {
    const itemName = data.items.find((it) => it.defId === curve.material.itemId)?.name ?? curve.material.itemId;
    text += ` + ${curve.material.qtyPerLevel}× ${itemName}`;
  }
  return text;
}

/**
 * Run an equip/enhance action: disable the button, apply the result (unless
 * the action already applied it itself, e.g. enhance also refreshes gold),
 * and surface server errors at the panel level (same pattern as pvp.js's
 * defense-save button).
 */
async function runAction(btn, action, appliedInside = false) {
  btn.disabled = true;
  els.msgs.innerHTML = "";
  try {
    const result = await action();
    if (!appliedInside) applyInventory(result);
  } catch (e) {
    pushMsg(e.message, true);
    btn.disabled = false;
  }
}

/**
 * Run a sell-to-system action ({gold, inventory} response, same shape as
 * enhance()/repair()): apply the refreshed inventory, refresh the header's
 * gold chip, and surface the given success message — or the server's error,
 * same pattern as runAction().
 */
async function runSell(btn, action, successMsg) {
  btn.disabled = true;
  els.msgs.innerHTML = "";
  try {
    const { inventory } = await action();
    applyInventory(inventory);
    refreshProfile(); // fire-and-forget, mirrors gold shown by farm.js's showProfile()
    pushMsg(successMsg);
  } catch (e) {
    pushMsg(e.message, true);
    btn.disabled = false;
  }
}

// ---------- runes tab ----------

function runesTab() {
  if (data.runes.length === 0) {
    return emptyState("No runes yet — grant one via the admin console, then socket it here.");
  }
  for (const r of data.runes) {
    els.body.appendChild(runeRow(r));
  }
}

function runeLocation(r) {
  return r.monsterId != null ? `Socketed: ${monsterName(r.monsterId)}` : "In bag";
}

function runeRow(r) {
  const row = el("div", "inv-row");
  const id = el("div", "inv-id");
  const txt = el("span");
  txt.append(el("b", null, r.name), el("small", null, r.description || "—"));
  id.append(txt);

  const side = el("div", "inv-actions");
  side.append(badge(`Lv ${r.level}`), el("span", "inv-charges", `${r.chargesLeft}/${r.maxCharges}`));
  if (r.broken) side.append(badge("BROKEN", "inv-broken"));
  side.append(el("span", "inv-loc", runeLocation(r)));
  side.append(...socketControls(r));
  const repairCtl = repairControl(r);
  if (repairCtl) side.append(repairCtl);
  const sellCtl = runeSellControl(r);
  if (sellCtl) side.append(sellCtl);

  row.append(id, side);
  return row;
}

/**
 * Sell-to-system control for one rune instance (Phase 8): only shown when
 * unsocketed and its def's `sellGold` is nonzero — broken runes ARE
 * sellable (same allowance as the marketplace's rune escrow), only "still
 * socketed" hides the button. Confirmed via a native confirm dialog.
 */
function runeSellControl(r) {
  if (!r.sellGold) return null;
  if (r.monsterId != null) return null;
  const btn = button(`Sell (${r.sellGold}🪙)`, "btn ghost inv-small", async () => {
    if (!window.confirm(`Sell ${r.name} for ${r.sellGold} 🪙?`)) return;
    await runSell(btn, () => sellToSystem({ kind: "rune", id: r.id }), `Sold ${r.name} for ${r.sellGold} 🪙`);
  });
  return btn;
}

/** Socket/unsocket controls: a monster picker + Socket button (hidden while
 *  broken — the server 409s anyway, this just saves the round trip), plus
 *  Unsocket when already socketed. Same shape as equipment's equipControls(). */
function socketControls(r) {
  const controls = [];
  if (!r.broken && monsters.length > 0) {
    const select = el("select", "inv-select");
    for (const m of monsters) {
      const opt = el("option", null, m.name);
      opt.value = String(m.id);
      if (m.id === r.monsterId) opt.selected = true;
      select.appendChild(opt);
    }
    const socketBtn = button("Socket", "btn ghost inv-small", async () => {
      await runAction(socketBtn, () => socketRune(r.id, Number(select.value)));
    });
    controls.push(select, socketBtn);
  }
  if (r.monsterId != null) {
    const unsocketBtn = button("Unsocket", "btn ghost inv-small", async () => {
      await runAction(unsocketBtn, () => socketRune(r.id, null));
    });
    controls.push(unsocketBtn);
  }
  return controls;
}

/** Repair control: cost-labeled button, shown whenever the rune could use
 *  one (broken, or just short of full charges) — same response shape
 *  ({gold, inventory}) as enhance, handled the same way. */
function repairControl(r) {
  if (!r.broken && r.chargesLeft >= r.maxCharges) return null;
  const btn = button(`Repair — ${r.repairGold}🪙`, "btn primary inv-small", async () => {
    await runAction(btn, async () => {
      const { gold, inventory } = await repairRune(r.id);
      applyInventory(inventory);
      refreshProfile(); // fire-and-forget, mirrors gold shown by farm.js's showProfile()
      return gold;
    }, true /* already applied inside */);
  });
  return btn;
}
