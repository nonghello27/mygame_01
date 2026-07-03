// Arena panel (Phase 6 step 5): the PVP ladder and the defense-formation
// editor. Pure presentation over /api/ladder and /api/formation — every
// number (rating, rank, season end date) comes from the server.
//
// The "Ranked Battle" button does NOT run a second battle flow: it asks
// main.js (via the callback passed to initPvp()) to open a mode:"pvp" match
// through the exact same backToSetup()/openMatch() plumbing "New Opponent"
// already uses, then closes this panel so the board takes over — the actual
// fight (Start Battle -> runBattle()) is untouched.

import { fetchLadder, fetchDefense, saveDefense, loadFarm } from "../services/content.js";
import { fetchMe } from "../services/auth.js";

const TABS = [
  ["ladder", "🏆 Ladder"],
  ["defense", "🛡 Defense"],
];

let els = null;
let tab = "ladder";
let onRankedBattle = async () => {};
let myId = null; // this trainer's id, resolved once, used to highlight "me" on the ladder

let ladder = null;  // { season, top, me }
let defense = null; // { formationId, name, slots } | null
let farm = null;    // loadFarm() result: { monsters, active, ... }
let picks = [];      // in-progress defense editor picks: [monsterId, ...] front-first

/** @param {() => Promise<void>} rankedBattleCb opens a PVP match and returns
 *  to the setup board (throws on failure, e.g. no opponents available). */
export function initPvp(rankedBattleCb) {
  onRankedBattle = rankedBattleCb || onRankedBattle;
  els = {
    btn: document.getElementById("pvpBtn"),
    panel: document.getElementById("pvpPanel"),
    tabs: document.getElementById("pvpTabs"),
    msgs: document.getElementById("pvpMsgs"),
    body: document.getElementById("pvpBody"),
  };
  els.btn.addEventListener("click", toggle);
}

async function toggle() {
  const opening = els.panel.hidden;
  els.panel.hidden = !opening;
  els.btn.textContent = opening ? "⚔ Close Arena" : "⚔ Arena";
  if (opening) await refresh();
}

function closePanel() {
  els.panel.hidden = true;
  els.btn.textContent = "⚔ Arena";
}

/** Reload whatever the current tab needs and re-render. */
async function refresh() {
  els.msgs.innerHTML = "";
  renderTabs();
  try {
    if (!myId) myId = (await fetchMe())?.id ?? null;
    if (tab === "ladder") ladder = await fetchLadder();
    else await loadDefenseTab();
  } catch (e) {
    pushMsg(`Could not load the arena: ${e.message}`, true);
  }
  renderBody();
}

async function loadDefenseTab() {
  const [d, f] = await Promise.all([fetchDefense(), loadFarm()]);
  defense = d;
  farm = f;
  picks = defense ? defense.slots.map((s) => s.monsterId) : [];
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

// ---------- shell ----------

function renderTabs() {
  els.tabs.innerHTML = "";
  for (const [id, label] of TABS) {
    els.tabs.appendChild(button(label, "pvp-tab" + (id === tab ? " active" : ""), () => selectTab(id)));
  }
}

async function selectTab(id) {
  if (id === tab) return;
  tab = id;
  els.msgs.innerHTML = "";
  renderTabs();
  els.body.innerHTML = "";
  try {
    if (tab === "ladder" && !ladder) ladder = await fetchLadder();
    if (tab === "defense" && !farm) await loadDefenseTab();
  } catch (e) {
    pushMsg(`Could not load: ${e.message}`, true);
  }
  renderBody();
}

function renderBody() {
  els.body.innerHTML = "";
  if (tab === "ladder") renderLadder();
  else renderDefense();
}

// ---------- ladder tab ----------

function renderLadder() {
  if (!ladder) {
    els.body.appendChild(el("p", "pvp-hint", "Loading…"));
    return;
  }

  const endsAt = new Date(ladder.season.endsAt);
  els.body.appendChild(el(
    "p", "pvp-season",
    `Season ends ${endsAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
  ));

  const meCard = el("div", "pvp-me");
  meCard.append(
    el("b", null, `Rating ${ladder.me.rating}`),
    el("span", null, `Rank #${ladder.me.rank} · ${ladder.me.wins}W ${ladder.me.losses}L ${ladder.me.draws}D`),
  );
  els.body.appendChild(meCard);

  const rankedBtn = button("⚔ Ranked Battle", "btn primary pvp-ranked-btn", async () => {
    rankedBtn.disabled = true;
    els.msgs.innerHTML = "";
    try {
      await onRankedBattle();
      closePanel();
    } catch (e) {
      pushMsg(e.message, true);
    } finally {
      rankedBtn.disabled = false;
    }
  });
  els.body.appendChild(rankedBtn);

  const table = el("div", "pvp-table");
  const head = el("div", "pvp-row pvp-head");
  head.append(el("span", null, "#"), el("span", null, "Trainer"), el("span", null, "Rating"), el("span", null, "W/L/D"));
  table.appendChild(head);
  ladder.top.forEach((row, i) => {
    const r = el("div", "pvp-row" + (row.trainerId === myId ? " me" : ""));
    r.append(
      el("span", null, String(i + 1)),
      el("span", null, row.name),
      el("span", null, String(row.rating)),
      el("span", null, `${row.wins}/${row.losses}/${row.draws}`),
    );
    table.appendChild(r);
  });
  els.body.appendChild(table);
}

// ---------- defense tab ----------

function renderDefense() {
  if (!farm) {
    els.body.appendChild(el("p", "pvp-hint", "Loading…"));
    return;
  }

  els.body.appendChild(el("h4", "pvp-subhead", "Current formation"));
  if (defense) {
    const row = el("div", "pvp-current");
    for (const s of defense.slots) row.appendChild(defenseChip(s));
    els.body.appendChild(row);
  } else {
    els.body.appendChild(el(
      "p", "pvp-hint",
      "No defense formation saved yet — other trainers can't challenge you until you set one."
    ));
  }

  els.body.appendChild(el("h4", "pvp-subhead", "Choose 3, in order (front first)"));
  const list = el("div", "pvp-mon-list");
  for (const m of farm.monsters) {
    const activity = farm.active.find((a) => a.monsterId === m.id);
    const pickIdx = picks.indexOf(m.id);
    const row = el("div", "pvp-mon" + (pickIdx !== -1 ? " picked" : "") + (activity ? " busy" : ""));
    row.append(el("span", "pvp-mon-emoji", m.emoji), el("span", "pvp-mon-name", m.name));
    if (activity) row.append(el("span", "pvp-mon-busy-tag", activity.kind === "work" ? "Working" : "Training"));
    if (pickIdx !== -1) row.append(el("span", "pvp-pick-badge", String(pickIdx + 1)));
    row.addEventListener("click", () => togglePick(m.id));
    list.appendChild(row);
  }
  els.body.appendChild(list);

  const saveBtn = button("Save Formation", "btn primary pvp-small", async () => {
    saveBtn.disabled = true;
    els.msgs.innerHTML = "";
    try {
      defense = await saveDefense(picks);
      picks = defense.slots.map((s) => s.monsterId);
      pushMsg("Defense formation saved.");
      renderBody();
    } catch (e) {
      pushMsg(e.message, true);
      saveBtn.disabled = false;
    }
  });
  saveBtn.disabled = picks.length !== 3;

  const clearBtn = button("Clear picks", "btn ghost pvp-small", () => {
    picks = [];
    renderBody();
  });

  const bar = el("div", "pvp-toolbar");
  bar.append(saveBtn, clearBtn);
  els.body.appendChild(bar);
}

function togglePick(monsterId) {
  const i = picks.indexOf(monsterId);
  if (i !== -1) picks.splice(i, 1);
  else if (picks.length < 3) picks.push(monsterId);
  renderBody();
}

function defenseChip(s) {
  const chip = el("div", "pvp-chip");
  chip.append(el("span", null, s.emoji || "❔"), el("b", null, s.name ?? `#${s.monsterId}`));
  return chip;
}
