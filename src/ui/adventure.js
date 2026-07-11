// Adventure panel (Phase 7.4 step B, follow-up UI task): the second
// player-facing acquisition path — send a 3-monster party down a route,
// pick an option at each step, come home with loot (and maybe a caught
// monster). Same tab-less panel shell as ui/summon.js (a msgs div + a body
// div, one refresh() that re-reads and re-renders); the party picker
// (Phase 10.9) hosts ui/partyPicker.js's shared 3-lane drag-and-drop widget
// — the same card-based experience as the Setup Team panel.
//
// Pure presentation + action layer: the map, every roll, the enemy team,
// and the catch are ALL decided server-side (CLAUDE.md §1.1). This module
// never computes an outcome — it only narrates whatever the server just
// resolved. A battle option now (Phase 10.14) STAGES a fight instead of
// resolving it inline — this panel hands the staged snapshot off to
// main.js's `enterBattle` hook, which loads it onto the REAL battlefield
// and replays it through core/battle.js's normal replayer; this module
// itself never replays events, it only stages/narrates whatever the server
// has already resolved (CLAUDE.md §1.2).

import {
  fetchAdventureState, startAdventure, moveAdventure, abandonAdventure,
  loadFarm, fetchInventory,
} from "../services/content.js";
import { registerView } from "./views.js";
import { createPartyPicker } from "./partyPicker.js";

const NODE_ICON = { battle: "⚔", chest: "🎁", gather: "🌿" };
const NODE_LABEL = { battle: "Battle", chest: "Chest", gather: "Gather" };

let els = null;
let hooks = null;     // { enterBattle(pendingBattle) } — injected by main.js (initPvp precedent)
let adventures = [];  // last fetchAdventureState() result's `adventures`
let session = null;   // the active session view, or null
let lastTerminal = null; // most recent completed/failed/abandoned session, kept for the summary
let roster = null;    // loadFarm() result, only loaded while picking a party
let picker = null;     // the current createPartyPicker() instance, while picking a party
let items = [];        // owned item stacks, for loot-name lookup only
let busy = false;      // true while a start/move/abandon request is in flight

/** @param {{enterBattle:(pending:object)=>Promise<void>}} h main.js's
 *  battlefield handoff — never import main.js here (the initPvp precedent). */
export function initAdventure(h) {
  hooks = h;
  els = {
    btn: document.getElementById("adventureBtn"),
    panel: document.getElementById("adventurePanel"),
    msgs: document.getElementById("adventureMsgs"),
    body: document.getElementById("adventureBody"),
  };
  registerView("adventure", { button: els.btn, el: els.panel, onShow: refresh });
}

/** Called by main.js right after a staged battle resolves (a win/loss on the
 *  battlefield) or is surrendered — folds the fresh session back into this
 *  panel's own state. Never renders itself: the panel isn't visible yet
 *  while the battlefield is up, and its onShow (refresh) re-renders once the
 *  player actually returns here (the Continue handoff). */
export function noteAdventureBattleResult(result) {
  if (result.session.state === "active") {
    session = result.session;
    lastTerminal = null;
  } else {
    lastTerminal = result.session;
    session = null;
  }
}

/** Re-read routes + the current session (and, only while picking a party,
 *  the roster) and re-render. */
async function refresh() {
  els.msgs.innerHTML = "";
  try {
    const [state, inventory] = await Promise.all([
      fetchAdventureState(),
      fetchInventory().catch(() => null), // item-name lookup is a nicety — degrade to raw ids
    ]);
    adventures = state.adventures;
    session = state.session;
    items = inventory?.items ?? items;
    if (!session && !lastTerminal) {
      roster = await loadFarm();
      picker = createPartyPicker({ monsters: roster.monsters, onChange: updateSetOutButtons });
    }
  } catch (e) {
    adventures = [];
    session = null;
    pushMsg(`Could not load the Adventure desk: ${e.message}`, true);
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

function itemName(itemId) {
  return items.find((it) => it.defId === itemId)?.name ?? itemId;
}

// ---------- shell ----------

function renderBody() {
  els.body.innerHTML = "";
  if (session) renderActive();
  else if (lastTerminal) renderTerminal();
  else renderSetup();
}

// ---------- no session: route list + party picker ----------

let setOutButtons = []; // this render's "Set out" buttons — kept in sync by updateSetOutButtons()

function renderSetup() {
  if (!roster) {
    els.body.appendChild(el("p", "adv-hint", "Loading…"));
    return;
  }

  els.body.appendChild(el(
    "h4", "adv-subhead",
    "Choose your party — drag 3 monsters into the lanes (lane 1 = front)"
  ));
  // The SAME picker instance persists across renderBody() calls — it's
  // never recreated here, only re-appended (its own DOM subtree, and the
  // slot picks inside it, survive being detached/reattached by
  // renderBody()'s `els.body.innerHTML = ""`).
  els.body.appendChild(picker.el);

  if (adventures.length === 0) {
    els.body.appendChild(el("p", "adv-hint", "No routes are open right now — check back later."));
    return;
  }
  setOutButtons = [];
  for (const a of adventures) els.body.appendChild(routeCard(a));
}

/** The picker's onChange — deliberately does NOT call renderBody() (that
 *  would recreate the picker and lose the in-progress slot picks); it only
 *  keeps every route's "Set out" button in sync with whether all 3 lanes
 *  are filled. */
function updateSetOutButtons(slots) {
  const full = slots.every((id) => id != null);
  for (const btn of setOutButtons) btn.disabled = !full;
}

function routeCard(a) {
  const card = el("div", "adv-card");
  card.append(el("b", null, a.name));
  if (a.description) card.append(el("p", "adv-desc", a.description));

  const setOutBtn = button("Set out", "btn primary adv-small", async () => {
    setOutBtn.disabled = true;
    els.msgs.innerHTML = "";
    try {
      const result = await startAdventure(a.id, picker.getSlots());
      session = result.session;
      lastTerminal = null;
      roster = null;
      picker = null;
      pushMsg(`Setting out on ${a.name}…`);
      renderBody();
    } catch (e) {
      pushMsg(e.message, true);
      setOutBtn.disabled = false;
    }
  });
  setOutBtn.disabled = !picker.getSlots().every((id) => id != null);
  card.append(setOutBtn);
  setOutButtons.push(setOutBtn);
  return card;
}

// ---------- active session ----------

function routeName(adventureId) {
  return adventures.find((a) => a.id === adventureId)?.name ?? adventureId;
}

function renderActive() {
  els.body.appendChild(el(
    "p", "adv-header",
    `${routeName(session.adventureId)} — step ${session.position + 1}/${session.totalSteps}`
  ));

  const party = el("div", "adv-party");
  for (const m of session.party) {
    const chip = el("span", "adv-party-chip");
    chip.append(el("span", null, m.emoji || "❔"), el("b", null, m.name));
    party.appendChild(chip);
  }
  els.body.appendChild(party);

  if (session.loot.length > 0) {
    els.body.appendChild(el("h4", "adv-subhead", "Run so far"));
    els.body.appendChild(logView(session.loot));
  }

  // A staged battle forces the only two moves left to battle/surrender — the
  // battlefield itself is where surrender lives now, so this state has no
  // Abandon button of its own (two different give-up buttons on one screen
  // would be confusing).
  if (session.pendingBattle) {
    renderPendingBattle();
    return;
  }

  els.body.appendChild(el("h4", "adv-subhead", "What next?"));
  const options = el("div", "adv-options");
  (session.options ?? []).forEach((opt, i) => options.appendChild(optionCard(opt, i)));
  els.body.appendChild(options);

  const abandonBtn = button("Abandon", "btn ghost adv-danger", async () => {
    if (!window.confirm("Abandon this run? Your party comes home empty-handed.")) return;
    abandonBtn.disabled = true;
    els.msgs.innerHTML = "";
    try {
      const result = await abandonAdventure();
      lastTerminal = result.session;
      session = null;
      renderBody();
    } catch (e) {
      pushMsg(e.message, true);
      abandonBtn.disabled = false;
    }
  });
  abandonBtn.disabled = busy;
  els.body.appendChild(abandonBtn);
}

/** A battle option was picked — the fight is staged, waiting on the
 *  battlefield. Show who's blocking the path and hand off to it. */
function renderPendingBattle() {
  const pb = session.pendingBattle;
  const notice = el("div", "adv-card adv-option");
  notice.append(el("span", "adv-option-icon", NODE_ICON.battle));
  notice.append(el(
    "b", null,
    `A battle blocks the path — ${pb.enemy.length} wild monster${pb.enemy.length === 1 ? "" : "s"} await.`
  ));
  const enemies = el("div", "adv-party");
  for (const m of pb.enemyDisplay ?? []) {
    const chip = el("span", "adv-party-chip");
    chip.append(el("span", null, m.emoji || "❔"), el("b", null, m.name));
    enemies.appendChild(chip);
  }
  notice.append(enemies);
  notice.append(button("To battle", "btn primary adv-small", () => hooks.enterBattle(pb)));
  els.body.appendChild(notice);
}

function optionCard(opt, index) {
  const card = el("div", "adv-card adv-option");
  card.append(el("span", "adv-option-icon", NODE_ICON[opt.type] ?? "❔"));
  card.append(el("b", null, NODE_LABEL[opt.type] ?? opt.type));
  const goBtn = button("Go", "btn primary adv-small", async () => {
    busy = true;
    renderBody();
    els.msgs.innerHTML = "";
    try {
      const result = await moveAdventure(index);
      if (result.node.staged) {
        // The fight is staged — hand off to the real battlefield instead of
        // narrating a text outcome; that view now owns the panel handoff.
        session = result.session;
        await hooks.enterBattle(result.session.pendingBattle);
        return;
      }
      pushMsg(nodeOutcomeMsg(result.node));
      if (result.session.state === "active") {
        session = result.session;
      } else {
        lastTerminal = result.session;
        session = null;
      }
    } catch (e) {
      pushMsg(e.message, true);
    } finally {
      busy = false;
      renderBody();
    }
  });
  goBtn.disabled = busy;
  card.append(goBtn);
  return card;
}

/** One human-readable line for the node the server just resolved. Battle
 *  nodes no longer reach here at all (Phase 10.14) — a battle option always
 *  stages instead (handled separately in optionCard's Go handler), so this
 *  only ever narrates a chest/gather outcome. */
function nodeOutcomeMsg(node) {
  const parts = [];
  if (node.loot) parts.push(`Found ${lootText(node.loot)}.`);
  if (node.catch) parts.push(`Caught ${node.catch.name}!`);
  return parts.join(" ") || "Nothing happened.";
}

function lootText(loot) {
  return loot.map((l) => `+${l.qty} ${itemName(l.itemId)}`).join(", ");
}

// ---------- run log (shared between the active view and the terminal summary) ----------

function logView(entries) {
  const log = el("div", "adv-log");
  for (const entry of entries) log.appendChild(logLine(entry));
  return log;
}

function logLine(entry) {
  const line = el("div", "adv-log-line");
  line.append(el("span", "adv-log-icon", NODE_ICON[entry.type] ?? "❔"));
  const bits = [];
  if (entry.error) bits.push(`error: ${entry.error}`);
  if (entry.battle) bits.push(entry.battle.won ? "won" : entry.battle.surrendered ? "surrendered" : "lost");
  if (entry.loot) bits.push(lootText(entry.loot));
  if (entry.catch) bits.push(`caught ${entry.catch.name}!`);
  line.append(el("span", null, bits.join(" · ") || "—"));
  return line;
}

// ---------- terminal session summary ----------

function renderTerminal() {
  const lastEntry = lastTerminal.loot[lastTerminal.loot.length - 1];
  const surrendered = lastTerminal.state === "failed" && lastEntry?.battle?.surrendered;
  const headline = surrendered
    ? "The party surrendered…"
    : ({
        completed: "Adventure complete!",
        failed: "The party was defeated…",
        abandoned: "Adventure abandoned.",
      }[lastTerminal.state] ?? "Adventure over.");

  els.body.appendChild(el("p", "adv-header", `${routeName(lastTerminal.adventureId)} — ${headline}`));

  if (lastTerminal.state === "completed") {
    els.body.appendChild(el("h4", "adv-subhead", "What you brought home"));
    els.body.appendChild(homeHaulView(lastTerminal.loot));
  } else {
    els.body.appendChild(el("p", "adv-hint", "Everything found on this run was forfeited."));
  }

  if (lastTerminal.loot.length > 0) {
    els.body.appendChild(el("h4", "adv-subhead", "Run summary"));
    els.body.appendChild(logView(lastTerminal.loot));
  }

  els.body.appendChild(button("End Adventure", "btn primary adv-small", () => {
    lastTerminal = null;
    refresh();
  }));
}

/** Aggregate a completed run's escrowed loot log into one summary: item
 *  qtys summed across every chest/gather entry, plus each catch by name —
 *  the same figures grantRunRewards() actually granted server-side. */
function homeHaulView(loot) {
  const qtyByItem = new Map();
  const catches = [];
  for (const entry of loot) {
    if (entry.loot) {
      for (const { itemId, qty } of entry.loot) {
        qtyByItem.set(itemId, (qtyByItem.get(itemId) ?? 0) + qty);
      }
    }
    if (entry.catch) catches.push(entry.catch);
  }
  const wrap = el("div", "adv-log");
  if (qtyByItem.size === 0 && catches.length === 0) {
    wrap.appendChild(el("p", "adv-hint", "The party came home empty-handed."));
    return wrap;
  }
  for (const [itemId, qty] of qtyByItem) {
    wrap.appendChild(el("div", "adv-log-line", `+${qty} ${itemName(itemId)}`));
  }
  for (const c of catches) {
    wrap.appendChild(el("div", "adv-log-line", `${c.name} (caught)`));
  }
  return wrap;
}
