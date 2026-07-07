// Party strip (Phase 10.2): pick WHICH 3 owned monsters fight, and in what
// initial lane order — a choice the server re-validates (CLAUDE.md §1.1),
// never trusted stats or outcomes. Pure display + one callback, same
// "module remembers, main.js acts" shape as ui/pvp.js's "Ranked Battle"
// button: this module never opens a match itself.
//
// The roster read + row shape borrows straight from ui/adventure.js's party
// picker / ui/pvp.js's defense editor (loadFarm() -> {monsters}, click to
// toggle a pick, busy monsters disabled with their busyKind label).

import { loadFarm } from "../services/content.js";
import { state } from "../core/state.js";

const BUSY_LABEL = { work: "Working", training: "Training", adventure: "On adventure" };
const PARTY_SIZE = 3;

let els = null;
let onFieldParty = async () => {};
let roster = null;      // last loadFarm().monsters, or null if the read failed
let selection = [];     // in-progress picks, in pick order
let chosenIds = null;   // null = "server default"; otherwise the last fielded picks

/** @param {{onFieldParty: () => void|Promise<void>}} opts */
export function initParty({ onFieldParty: cb } = {}) {
  onFieldParty = cb || onFieldParty;
  els = { strip: document.getElementById("partyStrip") };
}

/**
 * The ids to send with the NEXT match, or null for the server default (first
 * 3 available) — read by main.js's openMatch().
 */
export function getPartyIds() {
  return chosenIds;
}

/**
 * Re-read the roster and re-render the strip. Never throws — a failed read
 * just leaves the strip empty rather than breaking the board (this is
 * battlefield furniture, not a required panel).
 */
export async function renderParty() {
  if (!els?.strip) return;
  els.strip.hidden = false;
  try {
    const farm = await loadFarm();
    roster = farm.monsters;
  } catch {
    roster = null;
  }
  // Every full refresh (called only right after a match opens, never mid-click)
  // resets the working selection to whatever's actually fielded now.
  selection = fieldedIds();
  render();
}

function fieldedIds() {
  return state.armyA.map((u) => u.monsterId).filter((id) => id != null);
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((id) => sb.has(id));
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

// ---------- rendering ----------

function render() {
  if (!els?.strip) return;
  els.strip.innerHTML = "";
  if (!roster) return; // never break the board over a failed read

  const list = el("div", "party-chips");
  for (const m of roster) {
    const isBusy = m.busyUntil && new Date(m.busyUntil) > new Date();
    const pickIdx = selection.indexOf(m.id);
    const chip = el("button", "party-chip" + (pickIdx !== -1 ? " picked" : "") + (isBusy ? " busy" : ""));
    chip.type = "button";
    chip.disabled = isBusy;
    chip.append(el("span", "party-chip-emoji", m.emoji || "❔"), el("span", "party-chip-name", m.name));
    if (isBusy) chip.append(el("span", "party-chip-busy", `busy: ${BUSY_LABEL[m.busyKind] ?? m.busyKind ?? "?"}`));
    if (pickIdx !== -1) chip.append(el("span", "party-chip-badge", String(pickIdx + 1)));
    if (!isBusy) chip.addEventListener("click", () => togglePick(m.id));
    list.appendChild(chip);
  }
  els.strip.appendChild(list);

  const bar = el("div", "party-bar");
  const canField = selection.length === PARTY_SIZE && !sameSet(selection, fieldedIds());
  if (canField) {
    bar.appendChild(button("Field this party", "btn primary party-field-btn", async () => {
      chosenIds = [...selection];
      await applyPartyChange();
    }));
  }
  if (chosenIds != null) {
    bar.appendChild(button("Default party", "btn ghost party-auto-btn", async () => {
      chosenIds = null;
      await applyPartyChange();
    }));
  }
  if (bar.children.length > 0) els.strip.appendChild(bar);
}

/** Run the field/reset callback, disabling the strip's buttons meanwhile,
 *  then re-render regardless of outcome (a failure still needs the
 *  "Default party" fallback to show, since chosenIds already changed). */
async function applyPartyChange() {
  for (const b of els.strip.querySelectorAll("button")) b.disabled = true;
  try {
    await onFieldParty();
  } finally {
    render();
  }
}

function togglePick(monsterId) {
  const i = selection.indexOf(monsterId);
  if (i !== -1) selection.splice(i, 1);
  else if (selection.length < PARTY_SIZE) selection.push(monsterId);
  render();
}
