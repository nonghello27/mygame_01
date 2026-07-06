// Tournament panel (Phase 9.2): the first admin-scheduled event a player can
// enter. Same tab-less panel shell as ui/summon.js/ui/adventure.js (a msgs
// div + a body div, one refresh() that re-reads and re-renders); the
// register flow's 3-monster party picker borrows ui/adventure.js's shape
// directly (loadFarm() -> {monsters}, click to toggle a pick, order = pick
// order, busy monsters disabled with their busyKind label).
//
// Pure presentation + action layer: the registration window, the entry fee,
// the entrant count, and every reward line are ALL decided server-side
// (CLAUDE.md §1.1) — this module only renders whatever fetchTournaments()
// just returned and posts the two choices a player actually makes
// (tournamentId, and — at register time — which 3 monsters). The bracket/
// standings detail view is Phase 9.3; a tournament past its registration
// window (or already running/completed/cancelled) is shown as a compact
// history row only.

import {
  fetchTournaments, registerTournament, withdrawTournament, loadFarm,
} from "../services/content.js";

const PARTY_SIZE = 3;
const BUSY_LABEL = {
  work: "Working", training: "Training", adventure: "On adventure", tournament: "In a tournament",
};
const STATUS_LABEL = {
  scheduled: "Scheduled", registration: "Registration", running: "Running",
  completed: "Completed", cancelled: "Cancelled",
};

let els = null;
let tournaments = [];    // last fetchTournaments() result's `tournaments`
let roster = null;       // loadFarm() result, loaded lazily on first "Register" click
let registeringId = null; // tournament id whose party picker is expanded, or null
let picks = [];           // in-progress party picks for `registeringId`, in pick order

export function initTournament() {
  els = {
    btn: document.getElementById("tournamentBtn"),
    panel: document.getElementById("tournamentPanel"),
    msgs: document.getElementById("tournamentMsgs"),
    body: document.getElementById("tournamentBody"),
  };
  els.btn.addEventListener("click", toggle);
}

async function toggle() {
  const opening = els.panel.hidden;
  els.panel.hidden = !opening;
  els.btn.textContent = opening ? "🏆 Close Tournament" : "🏆 Tournament";
  if (opening) await refresh();
}

/** Re-read the tournament list and re-render; drops any in-progress party
 *  picker (a fresh list may have moved the entry we were registering for). */
async function refresh() {
  els.msgs.innerHTML = "";
  registeringId = null;
  picks = [];
  try {
    tournaments = (await fetchTournaments()).tournaments;
  } catch (e) {
    tournaments = [];
    pushMsg(`Could not load the Tournament desk: ${e.message}`, true);
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

function badge(text, extraCls) {
  return el("span", extraCls ? `tour-badge ${extraCls}` : "tour-badge", text);
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString();
}

// ---------- window helpers ----------

function windowEnded(t) {
  return Date.now() > new Date(t.regEndsAt).getTime();
}

function registrationOpenNow(t) {
  const now = Date.now();
  return now >= new Date(t.regStartsAt).getTime() && now <= new Date(t.regEndsAt).getTime();
}

/** Same "registerable by time window, not just status" rule the server
 *  applies — status must also still be pre-bracket. */
function isUpcoming(t) {
  return (t.status === "scheduled" || t.status === "registration") && !windowEnded(t);
}

// ---------- reward-line rendering ----------

function rewardText(r) {
  if (r.type === "gold") return `${r.amount} gold`;
  if (r.type === "item") return `${r.qty}× ${r.itemId}`;
  if (r.type === "equipment") return r.equipmentDefId;
  if (r.type === "rune") return r.runeDefId;
  return r.speciesId; // monster
}

function rewardListText(list) {
  return list.map(rewardText).join(", ");
}

const ORDINAL = { 1: "1st", 2: "2nd", 3: "3rd" };

/** One human-readable line per position (1/2/3, only if present) and per
 *  percentile tier — plain amounts/ids, no math, straight off the rewards
 *  JSONB the list response already carries. */
function rewardsSummaryLines(rewards) {
  const lines = [];
  const positionRewards = rewards?.positionRewards ?? {};
  for (const rank of [1, 2, 3]) {
    const list = positionRewards[rank] ?? positionRewards[String(rank)];
    if (list && list.length) lines.push(`${ORDINAL[rank]}: ${rewardListText(list)}`);
  }
  for (const tier of rewards?.percentileRewards ?? []) {
    lines.push(`Top ${tier.fromPct}–${tier.toPct}%: ${rewardListText(tier.rewards)}`);
  }
  return lines;
}

function feeText(entryFee) {
  return entryFee > 0 ? `${entryFee} 🪙` : "Free";
}

// ---------- shell ----------

function renderBody() {
  els.body.innerHTML = "";
  if (tournaments.length === 0) {
    els.body.appendChild(el("p", "tour-hint", "No tournaments have been scheduled yet — check back later."));
    return;
  }

  const open = tournaments.filter(isUpcoming);
  const history = tournaments.filter((t) => !isUpcoming(t));

  els.body.appendChild(el("h4", "tour-subhead", "Open & upcoming"));
  if (open.length === 0) {
    els.body.appendChild(el("p", "tour-hint", "Nothing open for registration right now."));
  } else {
    for (const t of open) els.body.appendChild(openCard(t));
  }

  els.body.appendChild(el("h4", "tour-subhead", "History"));
  if (history.length === 0) {
    els.body.appendChild(el("p", "tour-hint", "No past tournaments yet."));
  } else {
    for (const t of history) els.body.appendChild(historyRow(t));
  }
}

// ---------- open/upcoming card ----------

function openCard(t) {
  const card = el("div", "tour-card");

  const head = el("div", "tour-head");
  head.append(el("b", null, t.name), badge(feeText(t.entryFee), "tour-fee"));
  card.append(head);

  if (t.description) card.append(el("p", "tour-desc", t.description));

  card.append(el("p", "tour-window",
    `Registration: ${fmtDate(t.regStartsAt)} – ${fmtDate(t.regEndsAt)} · ${t.entrantCount} entered`));

  const rewardLines = rewardsSummaryLines(t.rewards);
  if (rewardLines.length > 0) {
    const rewards = el("div", "tour-rewards");
    for (const line of rewardLines) rewards.appendChild(el("p", "tour-reward-line", line));
    card.append(rewards);
  }

  if (t.myEntry) {
    card.append(el("p", "tour-registered",
      `Registered ${fmtDate(t.myEntry.enteredAt)} — paid ${feeText(t.myEntry.feePaid)}`));
    if (registrationOpenNow(t)) {
      card.append(withdrawButton(t));
    } else {
      card.append(el("p", "tour-hint", "Registration is closed."));
    }
  } else if (registrationOpenNow(t)) {
    if (registeringId === t.id) {
      card.append(registerPicker(t));
    } else {
      card.append(button(
        t.entryFee > 0 ? `Register — ${feeText(t.entryFee)}` : "Register",
        "btn primary tour-small",
        () => openRegister(t.id),
      ));
    }
  } else {
    card.append(el("p", "tour-hint", `Registration opens ${fmtDate(t.regStartsAt)}.`));
  }

  return card;
}

function withdrawButton(t) {
  const btn = button("Withdraw", "btn ghost tour-small tour-danger", async () => {
    btn.disabled = true;
    els.msgs.innerHTML = "";
    try {
      await withdrawTournament(t.id);
      pushMsg(`Withdrew from ${t.name}.`);
      roster = null; // busy locks just changed — force a fresh read next time
      await refresh();
    } catch (e) {
      pushMsg(e.message, true);
      btn.disabled = false;
    }
  });
  return btn;
}

// ---------- register flow: party picker ----------

async function openRegister(tournamentId) {
  registeringId = tournamentId;
  picks = [];
  if (!roster) {
    els.msgs.innerHTML = "";
    try {
      roster = await loadFarm();
    } catch (e) {
      pushMsg(`Could not load your roster: ${e.message}`, true);
      registeringId = null;
    }
  }
  renderBody();
}

function registerPicker(t) {
  const wrap = el("div", "tour-register");
  wrap.appendChild(el("h4", "tour-subhead", `Choose your party (${PARTY_SIZE}, in order — front first)`));

  if (!roster) {
    wrap.appendChild(el("p", "tour-hint", "Loading…"));
    return wrap;
  }

  wrap.appendChild(partyPicker());

  const confirmBtn = button(
    t.entryFee > 0 ? `Register — ${feeText(t.entryFee)}` : "Register",
    "btn primary tour-small",
    async () => {
      confirmBtn.disabled = true;
      els.msgs.innerHTML = "";
      try {
        await registerTournament(t.id, picks);
        pushMsg(`Registered for ${t.name}.`);
        roster = null; // busy locks just changed — force a fresh read next time
        await refresh();
      } catch (e) {
        pushMsg(e.message, true);
        confirmBtn.disabled = false;
      }
    },
  );
  confirmBtn.disabled = picks.length !== PARTY_SIZE;

  const cancelBtn = button("Cancel", "btn ghost tour-small", () => {
    registeringId = null;
    picks = [];
    renderBody();
  });

  const bar = el("div", "tour-toolbar");
  bar.append(confirmBtn, cancelBtn);
  wrap.appendChild(bar);
  return wrap;
}

function partyPicker() {
  const list = el("div", "tour-mon-list");
  for (const m of roster.monsters) {
    const isBusy = m.busyUntil && new Date(m.busyUntil) > new Date();
    const pickIdx = picks.indexOf(m.id);
    const row = el("div", "tour-mon" + (pickIdx !== -1 ? " picked" : "") + (isBusy ? " busy" : ""));
    row.append(el("span", "tour-mon-emoji", m.emoji), el("span", "tour-mon-name", m.name));
    if (isBusy) row.append(el("span", "tour-mon-busy-tag", BUSY_LABEL[m.busyKind] ?? m.busyKind ?? "Busy"));
    if (pickIdx !== -1) row.append(el("span", "tour-pick-badge", String(pickIdx + 1)));
    if (!isBusy) row.addEventListener("click", () => togglePick(m.id));
    list.appendChild(row);
  }
  return list;
}

function togglePick(monsterId) {
  const i = picks.indexOf(monsterId);
  if (i !== -1) picks.splice(i, 1);
  else if (picks.length < PARTY_SIZE) picks.push(monsterId);
  renderBody();
}

// ---------- history row ----------

function historyRow(t) {
  const card = el("div", "tour-card tour-history");

  const head = el("div", "tour-head");
  head.append(
    el("b", null, t.name),
    badge(STATUS_LABEL[t.status] ?? t.status, t.status === "cancelled" ? "tour-cancelled" : undefined),
  );
  card.append(head);

  card.append(el("p", "tour-desc", `${t.entrantCount} entered`));
  card.append(el("p", "tour-hint", "Bracket & standings — coming soon."));
  return card;
}
