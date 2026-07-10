// Setup Team panel (Phase 10.5) — replaces the Phase 10.2 battlefield party
// strip. Same contract: it owns the REMEMBERED party ids (`getPartyIds()`,
// null = server default) and never opens a match itself — `main.js` passes
// `onSaveTeam` in. Roster read borrows loadFarm(), the same source the old
// battlefield party strip read.
// Phase 10.9: the actual slots-over-roster widget (drag-and-drop lanes, the
// sortable card row, the click-for-detail area) now lives in
// ui/partyPicker.js — this module is just its HOST: it owns the roster read,
// the remembered party ids, and the Save team / Reset / Default party
// footer, and hands the picker a fresh instance on every refresh().

import { loadFarm } from "../services/content.js";
import { state } from "../core/state.js";
import { registerView } from "./views.js";
import { createPartyPicker } from "./partyPicker.js";

const PARTY_SIZE = 3;

let els = null;
let onSaveTeam = async () => {};
let roster = null;          // last loadFarm().monsters, or null if the read failed
let picker = null;          // the current createPartyPicker() instance
let chosenIds = null;       // null = "server default"; otherwise the last saved picks

/** @param {{onSaveTeam: () => void|Promise<void>}} opts */
export function initTeam({ onSaveTeam: cb } = {}) {
  onSaveTeam = cb || onSaveTeam;
  els = {
    btn: document.getElementById("teamBtn"),
    panel: document.getElementById("teamPanel"),
    msgs: document.getElementById("teamMsgs"),
    body: document.getElementById("teamBody"),
  };
  registerView("team", { button: els.btn, el: els.panel, onShow: refresh });
}

/**
 * The ids to send with the NEXT match, or null for the server default (first
 * 3 available) — read by main.js's openMatch().
 */
export function getPartyIds() {
  return chosenIds;
}

/**
 * Re-render the panel if it's open — main.js calls this after every match
 * open. Cheap no-op while closed.
 */
export async function renderTeam() {
  if (!els?.panel || els.panel.hidden) return;
  await refresh();
}

/** Re-read the roster, prefill the slots from what's actually fielded now,
 *  and re-render. Never throws — a failed read just leaves the body empty. */
async function refresh() {
  els.msgs.innerHTML = "";
  try {
    const farm = await loadFarm();
    roster = farm.monsters;
  } catch (e) {
    roster = null;
    pushMsg(`Could not load the roster: ${e.message}`, true);
  }
  render();
}

function fieldedIds() {
  const ids = state.armyA.map((u) => u.monsterId).filter((id) => id != null);
  const out = [null, null, null];
  for (let i = 0; i < PARTY_SIZE; i++) out[i] = ids[i] ?? null;
  return out;
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

// ---------- rendering ----------

function render() {
  els.body.innerHTML = "";
  if (!roster) return; // the msg already explains why

  picker = createPartyPicker({
    monsters: roster,
    initialSlots: fieldedIds(),
    onChange: refreshFooter,
  });
  els.body.append(picker.el);
  els.body.append(footerBar());
}

/** Re-render just the footer (Save team's disabled state) after a picker
 *  change — the picker owns its own re-render, this module only needs to
 *  keep "Save team" in sync with whether all 3 lanes are filled. */
function refreshFooter() {
  const old = els.body.querySelector(".team-bar");
  const fresh = footerBar();
  if (old) old.replaceWith(fresh);
  else els.body.append(fresh);
}

function footerBar() {
  const bar = el("div", "team-bar");
  const slots = picker.getSlots();
  const canSave = slots.every((id) => id != null);
  const saveBtn = button("Save team", "btn primary", async () => {
    setButtonsDisabled(bar, true);
    els.msgs.innerHTML = "";
    chosenIds = [...picker.getSlots()];
    try {
      await onSaveTeam();
      pushMsg("Team fielded — same enemy, new lineup.");
    } catch (e) {
      pushMsg(e.message, true);
    } finally {
      await refresh();
    }
  });
  saveBtn.disabled = !canSave;
  bar.appendChild(saveBtn);

  bar.appendChild(button("Reset", "btn ghost", () => {
    picker.setSlots([null, null, null]);
  }));

  if (chosenIds != null) {
    bar.appendChild(button("Default party", "btn ghost", async () => {
      setButtonsDisabled(bar, true);
      els.msgs.innerHTML = "";
      chosenIds = null;
      try {
        await onSaveTeam();
        pushMsg("Using the server's default party.");
      } catch (e) {
        pushMsg(e.message, true);
      } finally {
        await refresh();
      }
    }));
  }

  return bar;
}

function setButtonsDisabled(scope, disabled) {
  for (const b of scope.querySelectorAll("button")) b.disabled = disabled;
}
