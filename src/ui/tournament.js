// Tournament panel (Phase 9.2 list/register/withdraw + Phase 9.3 detail
// view). Same tab-less panel shell as ui/summon.js/ui/adventure.js (a msgs
// div + a body div, one refresh() that re-reads and re-renders); the
// register flow's 3-monster party picker borrows ui/adventure.js's shape
// directly (loadFarm() -> {monsters}, click to toggle a pick, order = pick
// order, busy monsters disabled with their busyKind label).
//
// Pure presentation + action layer: the registration window, the entry fee,
// the entrant count, every reward line, the bracket, and the standings are
// ALL decided server-side (CLAUDE.md §1.1) — this module only renders
// whatever fetchTournaments()/fetchTournamentDetail() just returned and
// posts the choices a player actually makes (tournamentId; which 3 monsters
// at register time; which tournament's detail to open). A "Details" button
// on every card/history row swaps the panel body for the bracket +
// standings detail view (Phase 9.3) — a running tournament shows its
// partial bracket with unplayed pairings marked "pending"; a scheduled or
// cancelled-before-ever-running tournament has no bracket to show at all.

import {
  fetchTournaments, registerTournament, withdrawTournament, loadFarm, fetchTournamentDetail,
} from "../services/content.js";
import { registerView } from "./views.js";

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
let detailId = null;      // tournament id whose detail view is showing, or null (list view)
let detail = null;        // last fetchTournamentDetail() result for `detailId`, or null while loading

export function initTournament() {
  els = {
    btn: document.getElementById("tournamentBtn"),
    panel: document.getElementById("tournamentPanel"),
    msgs: document.getElementById("tournamentMsgs"),
    body: document.getElementById("tournamentBody"),
  };
  registerView("tournament", { button: els.btn, el: els.panel, onShow: refresh });
}

/** Re-read the tournament list and re-render; drops any in-progress party
 *  picker (a fresh list may have moved the entry we were registering for)
 *  and returns to the list view out of any open detail view. */
async function refresh() {
  els.msgs.innerHTML = "";
  registeringId = null;
  picks = [];
  detailId = null;
  detail = null;
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

  if (detailId != null) {
    if (!detail) {
      els.body.appendChild(el("p", "tour-hint", "Loading…"));
      return;
    }
    els.body.appendChild(detailView());
    return;
  }

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

  card.append(button("Details", "btn ghost tour-small", () => openDetail(t.id)));
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
  card.append(button("Details", "btn ghost tour-small", () => openDetail(t.id)));
  return card;
}

// ---------- detail view: bracket + standings (Phase 9.3) ----------

async function openDetail(tournamentId) {
  detailId = tournamentId;
  detail = null;
  els.msgs.innerHTML = "";
  renderBody(); // show the "Loading…" state immediately
  try {
    detail = await fetchTournamentDetail(tournamentId);
  } catch (e) {
    pushMsg(`Could not load tournament detail: ${e.message}`, true);
    detailId = null;
  }
  renderBody();
}

function backToList() {
  detailId = null;
  detail = null;
  renderBody();
}

/** "Round 1"/"Round 2".. for anything bigger, "Semifinals" for the one round
 *  with exactly 2 pairings, "Final" for the last round (always 1 pairing). */
function roundLabel(round, idx) {
  if (round.pairings.length === 1) return "Final";
  if (round.pairings.length === 2) return "Semifinals";
  return `Round ${idx + 1}`;
}

/** entryId -> "emoji Trainer Name" (or "bye" for a null slot), reading only
 *  the detail response's own entrants/display — never another endpoint. */
function entrantLabel(entryId) {
  if (entryId == null) return "bye";
  const e = (detail.entrants ?? []).find((x) => x.entryId === entryId);
  if (!e) return `#${entryId}`;
  const emoji = e.display?.[0]?.emoji;
  return emoji ? `${emoji} ${e.trainerName}` : e.trainerName;
}

function sideSpan(entryId, winnerId) {
  if (entryId == null) return el("span", "tour-pairing-side tour-bye", "bye");
  const isWinner = winnerId != null && entryId === winnerId;
  return el("span", "tour-pairing-side" + (isWinner ? " tour-winner" : ""), entrantLabel(entryId));
}

function pairingRow(p) {
  const row = el("div", "tour-pairing");
  row.append(sideSpan(p.a, p.winner), el("span", "tour-pairing-vs", "vs"), sideSpan(p.b, p.winner));
  if (p.winner == null && p.a != null && p.b != null) row.append(el("span", "tour-pairing-pending", "pending"));
  return row;
}

function roundBlock(round, idx) {
  const block = el("div", "tour-round");
  block.append(el("h5", "tour-round-title", roundLabel(round, idx)));
  for (const p of round.pairings) block.append(pairingRow(p));
  return block;
}

function standingsList(standings) {
  const list = el("div", "tour-standings");
  for (const s of standings) {
    const row = el("div", "tour-standing-row");
    row.append(el("span", "tour-standing-rank", `#${s.rank}`));
    row.append(el("span", "tour-standing-name", s.trainerName ?? `#${s.trainerId}`));
    const rewardLine = s.reward?.rewards?.length ? rewardListText(s.reward.rewards) : "—";
    row.append(el("span", "tour-standing-reward", rewardLine));
    list.append(row);
  }
  return list;
}

function detailView() {
  const t = detail.tournament;
  const wrap = el("div", "tour-detail");

  const head = el("div", "tour-head");
  head.append(
    el("b", null, t.name),
    badge(STATUS_LABEL[t.status] ?? t.status, t.status === "cancelled" ? "tour-cancelled" : undefined),
  );
  wrap.append(head);
  if (t.status === "cancelled") wrap.append(el("p", "tour-hint tour-cancelled-note", "This tournament was cancelled."));
  wrap.append(el("p", "tour-desc", `${t.entrantCount} entered`));

  if (detail.rounds && detail.rounds.length) {
    wrap.append(el("h4", "tour-subhead", "Bracket"));
    detail.rounds.forEach((round, idx) => wrap.append(roundBlock(round, idx)));
    if (detail.thirdPlace) {
      const block = el("div", "tour-round");
      block.append(el("h5", "tour-round-title", "3rd-place match"), pairingRow(detail.thirdPlace));
      wrap.append(block);
    }
  } else {
    wrap.append(el("p", "tour-hint", "The bracket hasn't been drawn yet."));
  }

  if (detail.standings && detail.standings.length) {
    wrap.append(el("h4", "tour-subhead", "Standings"));
    wrap.append(standingsList(detail.standings));
  }

  wrap.append(button("Back", "btn ghost tour-small", backToList));
  return wrap;
}
