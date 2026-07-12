// Adventure panel (Phase 7.4 step B; Phase 11 rebuilds the run around an
// explorable grid maze). Same tab-less panel shell as ui/summon.js (a msgs
// div + a body div, one refresh() that re-reads and re-renders); the party
// picker (Phase 10.9) hosts ui/partyPicker.js's shared 3-lane drag-and-drop
// widget — the same card-based experience as the Setup Team panel.
//
// Pure presentation + action layer: the maze, every roll, the enemy team,
// and the catch are ALL decided server-side (CLAUDE.md §1.1). This module
// never computes an outcome — it only narrates whatever the server just
// resolved, and it renders only what the server SHIPPED (fog of war: an
// undiscovered cell is simply absent from `session.cells`, never inferred
// client-side). A battle option STAGES a fight instead of resolving it
// inline — this panel hands the staged snapshot off to main.js's
// `enterBattle` hook, which loads it onto the REAL battlefield and replays
// it through core/battle.js's normal replayer; this module itself never
// replays events, it only stages/narrates whatever the server has already
// resolved (CLAUDE.md §1.2).

import {
  fetchAdventureState, startAdventure, moveAdventure, exitAdventure, abandonAdventure,
  loadFarm, fetchInventory,
} from "../services/content.js";
import { fetchMe } from "../services/auth.js";
import { showProfile } from "./auth.js";
import { registerView } from "./views.js";
import { createPartyPicker } from "./partyPicker.js";
import { classIconEl } from "./board.js";
import { spriteEl } from "./sprite.js";
import { spriteFor } from "../data/sprites.js";

const NODE_ICON = { item: "🎁", battle: "⚔", stranded: "⏳" };

let els = null;
let hooks = null;     // { enterBattle(pendingBattle) } — injected by main.js (initPvp precedent)
let adventures = [];  // last fetchAdventureState() result's `adventures`
let session = null;   // the active session view, or null
let lastTerminal = null; // most recent completed/failed/abandoned session, kept for the summary
let lastGranted = null;  // exitAdventure()'s `granted` for the just-finished run's summary, or null
let roster = null;    // loadFarm() result, only loaded while picking a party
let picker = null;     // the current createPartyPicker() instance, while picking a party
let items = [];        // owned item stacks, for loot-name lookup only
let busy = false;      // true while a start/move/exit/abandon request is in flight
let facing = "right"; // "left" | "right" — display-only, which way the marker's art faces

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
    // Only exitAdventure() ever grants anything — a battle-triggered
    // stranding forfeits everything, same as a lost/abandoned run.
    lastGranted = null;
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

/** After a completed run's exit grants gold/exp, refresh the header's chips
 *  the same way the Summon Hall does after a pull — best-effort, never blocks. */
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

function itemName(itemId) {
  return items.find((it) => it.defId === itemId)?.name ?? itemId;
}

/** The one place a cell coordinate becomes a lookup key — matches the
 *  server's own `${x},${y}` wire keys 1:1, never re-derives anything about
 *  the maze itself (that would mean importing shared/rules into the UI). */
function key(x, y) {
  return `${x},${y}`;
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

function difficultySelect(a) {
  const sel = document.createElement("select");
  sel.className = "adv-select";
  for (const d of a.difficulties ?? []) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d.charAt(0).toUpperCase() + d.slice(1);
    if (d === "easy") opt.selected = true;
    sel.appendChild(opt);
  }
  return sel;
}

function routeCard(a) {
  const card = el("div", "adv-card");
  card.append(el("b", null, a.name));
  // `a.width` is missing for an old route an admin hasn't re-saved for the
  // grid grammar yet — skip the dimension line rather than show "undefined".
  if (a.width) card.append(el("p", "adv-desc", `${a.width}×${a.height} maze`));
  if (a.description) card.append(el("p", "adv-desc", a.description));

  const sel = difficultySelect(a);
  const row = el("div", "adv-row");
  row.append(sel);

  const setOutBtn = button("Set out", "btn primary adv-small", async () => {
    setOutBtn.disabled = true;
    sel.disabled = true;
    els.msgs.innerHTML = "";
    try {
      const result = await startAdventure(a.id, sel.value, picker.getSlots());
      session = result.session;
      lastTerminal = null;
      lastGranted = null;
      roster = null;
      picker = null;
      facing = "right";
      pushMsg(`Setting out on ${a.name} (${sel.value})…`);
      renderBody();
    } catch (e) {
      pushMsg(e.message, true);
      setOutBtn.disabled = false;
      sel.disabled = false;
    }
  });
  setOutBtn.disabled = !picker.getSlots().every((id) => id != null);
  row.append(setOutBtn);
  card.append(row);
  setOutButtons.push(setOutBtn);
  return card;
}

// ---------- active session ----------

function routeName(adventureId) {
  return adventures.find((a) => a.id === adventureId)?.name ?? adventureId;
}

/** Count of loot-log entries carrying anything the exit haul will actually
 *  tally — an item drop or a battle's gold/exp roll — for the HUD's simple
 *  "🎒 N" counter. Display-only; the real numbers live in the log below and,
 *  ultimately, in exitAdventure()'s own `granted`. */
function lootCount(loot) {
  return loot.filter((e) => (e.loot && e.loot.length > 0) || e.gold || e.exp).length;
}

function renderActive() {
  els.body.appendChild(el(
    "p", "adv-header",
    `${routeName(session.adventureId)} — ${session.difficulty}`
  ));

  const party = el("div", "adv-party");
  for (const m of session.party) {
    const chip = el("span", "adv-party-chip");
    chip.append(el("span", null, m.emoji || "❔"), el("b", null, m.name));
    party.appendChild(chip);
  }
  els.body.appendChild(party);

  const atEntrance = session.pos.x === session.entrance.x && session.pos.y === session.entrance.y;

  const hud = el("div", "adv-hud");
  hud.append(el("span", null, `👣 ${session.movesLeft}/${session.movesTotal} moves`));
  hud.append(el("span", null, `🎒 ${lootCount(session.loot)}`));

  const leaveBtn = button("Leave", "btn primary adv-small", async () => {
    busy = true;
    renderBody();
    els.msgs.innerHTML = "";
    try {
      const result = await exitAdventure();
      lastGranted = result.granted;
      lastTerminal = result.session;
      session = null;
      refreshProfile(); // fire-and-forget, mirrors gold shown by farm.js's showProfile()
    } catch (e) {
      pushMsg(e.message, true);
    } finally {
      busy = false;
      renderBody();
    }
  });
  leaveBtn.disabled = busy || !atEntrance || !!session.pendingBattle;
  hud.append(leaveBtn);

  const abandonBtn = button("Abandon", "btn ghost adv-danger", async () => {
    if (!window.confirm("Abandon this run? Your party comes home empty-handed.")) return;
    busy = true;
    renderBody();
    els.msgs.innerHTML = "";
    try {
      const result = await abandonAdventure();
      lastGranted = null;
      lastTerminal = result.session;
      session = null;
    } catch (e) {
      pushMsg(e.message, true);
    } finally {
      busy = false;
      renderBody();
    }
  });
  abandonBtn.disabled = busy;
  hud.append(abandonBtn);

  els.body.appendChild(hud);

  if (session.loot.length > 0) {
    els.body.appendChild(el("h4", "adv-subhead", "Run so far"));
    els.body.appendChild(logView(session.loot));
  }

  // A staged battle forces the only two moves left to battle/surrender — the
  // battlefield itself is where surrender lives now — so the notice sits
  // above the grid; no tile below is clickable while it's up (tileEl() folds
  // `session.pendingBattle` into its own reachability check).
  if (session.pendingBattle) renderPendingBattle();

  els.body.appendChild(renderGrid());
}

/** A battle option was picked — the fight is staged, waiting on the
 *  battlefield. Show who's blocking the path and hand off to it. */
function renderPendingBattle() {
  const pb = session.pendingBattle;
  const notice = el("div", "adv-card adv-option");
  notice.append(el("span", "adv-option-icon", NODE_ICON.battle));
  const count = pb.enemy?.length ?? 0;
  notice.append(el(
    "b", null,
    `A battle blocks the path — ${count} wild monster${count === 1 ? "" : "s"} await.`
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

// ---------- the grid ----------

/** Build the fog-of-war maze grid: ALL width×height cells render as tiles,
 *  looked up against the (sparse) `session.cells` the server actually
 *  shipped — anything not in there is undiscovered fog, rendered blank. */
function renderGrid() {
  const wrap = el("div", "adv-map");
  const grid = el("div", "adv-grid");
  grid.style.gridTemplateColumns = `repeat(${session.width}, var(--adv-tile))`;

  const byKey = new Map(session.cells.map((c) => [key(c.x, c.y), c]));
  for (let y = 0; y < session.height; y++) {
    for (let x = 0; x < session.width; x++) {
      grid.appendChild(tileEl(x, y, byKey.get(key(x, y))));
    }
  }
  wrap.appendChild(grid);
  return wrap;
}

function tileEl(x, y, cell) {
  const tile = el("button", "adv-tile");
  tile.type = "button";
  tile.disabled = true; // the default; only the reachable branch below flips it on

  if (!cell) {
    tile.classList.add("adv-tile--fog");
    return tile;
  }

  if (cell.terrain === "rock") {
    tile.classList.add("adv-tile--rock");
    return tile;
  }

  // open ground
  tile.classList.add("adv-tile--grass");
  if (cell.visited) tile.classList.add("adv-tile--visited");
  if (cell.cleared) tile.classList.add("adv-tile--cleared");

  const isHere = session.pos.x === x && session.pos.y === y;
  const isEntrance = x === session.entrance.x && y === session.entrance.y;
  if (isEntrance) tile.classList.add("adv-tile--entrance");

  if (cell.cleared) tile.append(el("span", "adv-tile-mark", "✓"));
  if (isEntrance && !isHere) tile.append(el("span", "adv-tile-mark", "🚪"));
  if (isHere) {
    tile.classList.add("adv-tile--here");
    tile.append(frontMarkerEl());
  }

  const reachable = !session.pendingBattle && !busy && session.state === "active"
    && (Math.abs(x - session.pos.x) + Math.abs(y - session.pos.y) === 1);
  if (reachable) {
    tile.classList.add("adv-tile--reachable");
    tile.disabled = false;
    tile.addEventListener("click", () => onMoveTile(x, y));
  }

  return tile;
}

/** The party's FRONT unit marks the current cell — its sprite PNG when the
 *  frozen display metadata carries a resolvable `sprite` (still portraits are
 *  authored facing RIGHT; `facing` flips them after a leftward move), falling
 *  back to the class-icon tile, then the emoji. */
function frontMarkerEl() {
  const front = session.party[0];
  const def = spriteFor(front?.sprite);
  let marker;
  if (def?.img) {
    marker = spriteEl(front); // chroma-keyed <img class="portrait-img">
  } else if (def?.sheet) {
    // SHEET kind: a static idle frame (row 0, frame 0) scaled to the tile —
    // background-size cols*100% makes each square cell exactly the marker's
    // own size, so position 0 0 is the idle frame at any tile size.
    marker = el("div", "adv-tile-marker--sheet");
    marker.style.backgroundImage = `url("${def.sheet}")`;
    marker.style.backgroundSize = `calc(${def.cols} * 100%) auto`;
  } else if (front?.cls) {
    marker = classIconEl(front.cls);
  } else {
    marker = el("span", null, front?.emoji || "❔");
  }
  marker.classList.add("adv-tile-marker");
  if (facing === "left") marker.classList.add("adv-tile-marker--flip");
  return marker;
}

/** Step onto one adjacent cell — the ONLY choice this sends is the target
 *  coordinate; everything about what happens next (an item roll, a staged
 *  battle, a stranding) is the server's own resolution, narrated here. */
async function onMoveTile(x, y) {
  facing = x < session.pos.x ? "left" : "right";
  busy = true;
  renderBody();
  els.msgs.innerHTML = "";
  try {
    const result = await moveAdventure(x, y);
    if (result.node.staged) {
      // The fight is staged — hand off to the real battlefield instead of
      // narrating a text outcome; that view now owns the panel handoff.
      session = result.session;
      await hooks.enterBattle(result.session.pendingBattle);
      return;
    }
    if (result.node.type === "item") pushMsg(`Found ${lootText(result.node.loot)}.`);
    if (result.node.stranded) {
      lastGranted = null;
      lastTerminal = result.session;
      session = null;
      pushMsg("⏳ Out of moves — the party is stranded! Everything found this run is forfeited.", true);
    } else {
      session = result.session;
    }
  } catch (e) {
    pushMsg(e.message, true);
  } finally {
    busy = false;
    renderBody();
  }
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
  if (entry.type === "stranded") bits.push("stranded — out of moves");
  if (entry.battle) bits.push(entry.battle.won ? "won" : entry.battle.surrendered ? "surrendered" : "lost");
  if (entry.gold || entry.exp) bits.push(`+${entry.gold ?? 0} gold, +${entry.exp ?? 0} exp`);
  if (entry.loot) bits.push(lootText(entry.loot));
  if (entry.catch) bits.push(`caught ${entry.catch.name}!`);
  line.append(el("span", null, bits.join(" · ") || "—"));
  return line;
}

// ---------- terminal session summary ----------

function renderTerminal() {
  const lastEntry = lastTerminal.loot[lastTerminal.loot.length - 1];
  const stranded = lastTerminal.state === "failed" && lastEntry?.type === "stranded";
  const surrendered = lastTerminal.state === "failed" && lastEntry?.battle?.surrendered;
  const headline = lastTerminal.state === "completed"
    ? "Adventure complete!"
    : stranded
    ? "Stranded — the party ran out of moves…"
    : surrendered
    ? "The party surrendered…"
    : ({
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
    lastGranted = null;
    refresh();
  }));
}

/** Aggregate a completed run's escrowed loot log into one summary: item
 *  qtys summed across every item entry, gold/exp summed across every battle
 *  entry, plus each catch by name. Prefers the stashed exitAdventure()
 *  `granted` (the server's own final tally) for gold/exp when it's on hand;
 *  either way the figures match what grantRunRewards() actually granted. */
function homeHaulView(loot) {
  const qtyByItem = new Map();
  const catches = [];
  let gold = 0, exp = 0;
  for (const entry of loot) {
    if (entry.loot) {
      for (const { itemId, qty } of entry.loot) {
        qtyByItem.set(itemId, (qtyByItem.get(itemId) ?? 0) + qty);
      }
    }
    if (entry.catch) catches.push(entry.catch);
    gold += entry.gold ?? 0;
    exp += entry.exp ?? 0;
  }
  if (lastGranted) {
    gold = lastGranted.gold ?? gold;
    exp = lastGranted.exp ?? exp;
  }

  const wrap = el("div", "adv-log");
  if (qtyByItem.size === 0 && catches.length === 0 && gold === 0 && exp === 0) {
    wrap.appendChild(el("p", "adv-hint", "The party came home empty-handed."));
    return wrap;
  }
  if (gold > 0) wrap.appendChild(el("div", "adv-log-line", `+${gold} gold`));
  if (exp > 0) wrap.appendChild(el("div", "adv-log-line", `+${exp} exp trainer exp`));
  for (const [itemId, qty] of qtyByItem) {
    wrap.appendChild(el("div", "adv-log-line", `+${qty} ${itemName(itemId)}`));
  }
  for (const c of catches) {
    wrap.appendChild(el("div", "adv-log-line", `${c.name} (caught)`));
  }
  return wrap;
}
