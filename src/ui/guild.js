// Guild panel (Phase 9.4 + 9.5's GVG section). Same tab-less panel shell as
// ui/tournament.js / ui/summon.js (a msgs div + a body div, one refresh()
// that re-reads and re-renders) — no state of its own beyond what
// fetchGuildMe()/fetchGuildBrowse()/fetchGvgEvents() just returned.
//
// Pure presentation + action layer: EVERY role check (who may accept/reject/
// kick/promote/transfer, who may even see the pending-application queue) is
// decided server-side (CLAUDE.md §1.1) — this module only renders whatever
// the last read returned and posts the handful of choices a player actually
// makes (a guild to apply to, an application to accept/reject, a trainer to
// kick/promote/transfer). Three renders off one fetchGuildMe() shape:
//   - guildless: my pending applications, a browse list with Apply/Applied,
//     and a "Found a guild" form.
//   - member/officer: guild header, roster, a Leave button; officers also
//     see the pending-application queue read-only (no accept/reject buttons —
//     only the leader acts on it).
//   - leader: all of the above, PLUS accept/reject on every application and
//     per-member (non-self) Kick/Promote/Demote/"Make leader" controls; the
//     leader's own Leave button is replaced by a "transfer first" hint.
//
// GVG section (Phase 9.5, member/officer/leader view only — the guildless
// view has nothing to submit a team for): every member sees open GVG events
// and can submit their own 3-monster team (the same party-picker shape
// ui/tournament.js's register flow uses, borrowed near-verbatim); the
// LEADER additionally sees every team the guild has submitted, with a
// per-team order input (order IS the relay order, first to last) and the
// register-guild button. Every lineup/registration validity check (role,
// window, team-count bounds, contiguous order) is the server's job — this
// only builds the ordered team-id list the leader actually entered and lets
// the server 409 with its own message for anything else (CLAUDE.md §1.1).
//
// GVG detail view (Phase 9.7): every history row's "Details" button swaps
// the WHOLE panel body (same swap ui/tournament.js's own Details button
// makes) for the war bracket + standings view, off one fetchGvgDetail()
// call — round labels, byes, "pending" pairings, and the standings list all
// reinstantiate ui/tournament.js's own rendering almost verbatim, plus a
// per-war battle-summary list (text only, CLAUDE.md §1.6 — no cutscene
// replay, the Adventure precedent) built from the response's `teams` map so
// a battle line can name whose team fought without ever seeing lanes.

import {
  fetchGuildBrowse, fetchGuildMe, createGuild, applyGuild, acceptGuildApplication,
  rejectGuildApplication, leaveGuild, kickGuildMember, promoteGuildMember,
  transferGuildLeadership,
  fetchGvgEvents, submitGvgTeam, withdrawGvgTeam, setGvgLineup, registerGvgGuild,
  fetchGvgDetail, loadFarm,
} from "../services/content.js";

const CREATE_COST_LABEL = "500 🪙"; // mirrors GUILD_CREATE_COST server/services/guild.js

const PARTY_SIZE = 3;
const BUSY_LABEL = {
  work: "Working", training: "Training", adventure: "On adventure",
  tournament: "In a tournament", gvg: "In a GVG team",
};
const GVG_STATUS_LABEL = {
  scheduled: "Scheduled", registration: "Registration", running: "Running",
  completed: "Completed", cancelled: "Cancelled",
};

let els = null;
let me = null;          // last fetchGuildMe() result
let guilds = null;      // last fetchGuildBrowse() result's `guilds`, loaded lazily (guildless only)
let gvgEvents = [];     // last fetchGvgEvents() result's `events`, loaded whenever the caller is in a guild
let gvgRoster = null;   // loadFarm() result, loaded lazily on first "Submit team" click (mirrors tournament.js's `roster`)
let submittingId = null; // GVG event id whose party picker is expanded, or null
let gvgPicks = [];       // in-progress team picks for `submittingId`, in pick order
let gvgDetailId = null;  // GVG event id whose detail (bracket/standings) view is showing, or null
let gvgDetail = null;    // last fetchGvgDetail() result for `gvgDetailId`, or null while loading

export function initGuild() {
  els = {
    btn: document.getElementById("guildBtn"),
    panel: document.getElementById("guildPanel"),
    msgs: document.getElementById("guildMsgs"),
    body: document.getElementById("guildBody"),
  };
  els.btn.addEventListener("click", toggle);
}

async function toggle() {
  const opening = els.panel.hidden;
  els.panel.hidden = !opening;
  els.btn.textContent = opening ? "🏰 Close Guild" : "🏰 Guild";
  if (opening) await refresh();
}

async function refresh() {
  els.msgs.innerHTML = "";
  submittingId = null;
  gvgPicks = [];
  gvgDetailId = null;
  gvgDetail = null;
  try {
    me = await fetchGuildMe();
    if (!me.guild) {
      guilds = (await fetchGuildBrowse()).guilds;
      gvgEvents = [];
    } else {
      // A GVG load failure shouldn't blank the whole guild view — caught
      // separately from the me()/browse() read above.
      try {
        gvgEvents = (await fetchGvgEvents()).events;
      } catch (e) {
        gvgEvents = [];
        pushMsg(`Could not load GVG events: ${e.message}`, true);
      }
    }
  } catch (e) {
    me = null;
    pushMsg(`Could not load the Guild hall: ${e.message}`, true);
  }
  renderBody();
}

function pushMsg(text, isError = false) {
  const p = document.createElement("p");
  p.textContent = text;
  p.classList.toggle("err", isError);
  els.msgs.appendChild(p);
}

// ---------- tiny DOM helpers (same shape as ui/tournament.js) ----------

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
  return el("span", extraCls ? `guild-badge ${extraCls}` : "guild-badge", text);
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString();
}

const ROLE_LABEL = { leader: "Leader", officer: "Officer", member: "Member" };

// ---------- shell ----------

function renderBody() {
  els.body.innerHTML = "";

  if (gvgDetailId != null) {
    if (!gvgDetail) {
      els.body.appendChild(el("p", "guild-hint", "Loading…"));
      return;
    }
    els.body.appendChild(gvgDetailView());
    return;
  }

  if (!me) return;

  els.body.appendChild(me.guild ? memberView() : guildlessView());
}

// ---------- guildless view: my applications + browse + create ----------

function guildlessView() {
  const wrap = el("div", "guild-view");

  const myApps = me.myApplications ?? [];
  if (myApps.length > 0) {
    wrap.appendChild(el("h4", "guild-subhead", "My applications"));
    for (const a of myApps) {
      const row = el("div", "guild-app-row");
      row.append(
        el("span", "guild-app-name", a.guildName),
        el("span", "guild-app-date", `Applied ${fmtDate(a.createdAt)}`),
      );
      wrap.append(row);
    }
  }

  wrap.appendChild(el("h4", "guild-subhead", "Guilds"));
  const list = guilds ?? [];
  if (list.length === 0) {
    wrap.appendChild(el("p", "guild-hint", "No guilds have been founded yet — be the first."));
  } else {
    const appliedIds = new Set(myApps.map((a) => a.guildId));
    for (const g of list) wrap.appendChild(browseCard(g, appliedIds.has(g.id)));
  }

  wrap.appendChild(createForm());
  return wrap;
}

function browseCard(g, alreadyApplied) {
  const card = el("div", "guild-card");
  const head = el("div", "guild-head");
  head.append(el("span", "guild-emblem", g.emblem), el("b", null, g.name),
    badge(`${g.memberCount} member${g.memberCount === 1 ? "" : "s"}`));
  card.append(head);
  if (g.description) card.append(el("p", "guild-desc", g.description));
  card.append(el("p", "guild-hint", `Led by ${g.leaderName}`));

  if (alreadyApplied) {
    const appliedBtn = button("Applied", "btn ghost guild-small", () => {});
    appliedBtn.disabled = true;
    card.append(appliedBtn);
  } else {
    card.append(applyControl(g));
  }
  return card;
}

function applyControl(g) {
  const wrap = el("div", "guild-apply");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Message to the leader (optional)";
  input.className = "guild-input";
  const btn = button("Apply", "btn primary guild-small", async () => {
    btn.disabled = true;
    els.msgs.innerHTML = "";
    try {
      await applyGuild(g.id, input.value);
      pushMsg(`Applied to ${g.name}.`);
      await refresh();
    } catch (e) {
      pushMsg(e.message, true);
      btn.disabled = false;
    }
  });
  wrap.append(input, btn);
  return wrap;
}

function createForm() {
  const wrap = el("div", "guild-create");
  wrap.appendChild(el("h4", "guild-subhead", "Found a guild"));

  const name = document.createElement("input");
  name.type = "text";
  name.placeholder = "Guild name (3-24 characters)";
  name.className = "guild-input";

  const description = document.createElement("input");
  description.type = "text";
  description.placeholder = "Description (optional)";
  description.className = "guild-input";

  const emblem = document.createElement("input");
  emblem.type = "text";
  emblem.placeholder = "Emblem (default 🏰)";
  emblem.className = "guild-input guild-input-emblem";

  const btn = button(`Create — ${CREATE_COST_LABEL}`, "btn primary guild-small", async () => {
    btn.disabled = true;
    els.msgs.innerHTML = "";
    try {
      await createGuild(name.value, description.value, emblem.value);
      pushMsg("Guild founded.");
      await refresh();
    } catch (e) {
      pushMsg(e.message, true);
      btn.disabled = false;
    }
  });

  wrap.append(name, description, emblem, btn);
  return wrap;
}

// ---------- member/officer/leader view ----------

function memberView() {
  const wrap = el("div", "guild-view");
  const g = me.guild;
  const isLeader = me.myRole === "leader";
  const isOfficer = me.myRole === "officer";

  const head = el("div", "guild-head guild-head-main");
  head.append(el("span", "guild-emblem guild-emblem-big", g.emblem), el("b", null, g.name),
    badge(ROLE_LABEL[me.myRole] ?? me.myRole));
  wrap.append(head);
  if (g.description) wrap.append(el("p", "guild-desc", g.description));

  if (isLeader && Array.isArray(me.applications)) {
    wrap.append(el("h4", "guild-subhead", "Pending applications"));
    if (me.applications.length === 0) {
      wrap.append(el("p", "guild-hint", "No pending applications."));
    } else {
      for (const a of me.applications) wrap.append(applicationRow(a, true));
    }
  } else if (isOfficer && Array.isArray(me.applications)) {
    wrap.append(el("h4", "guild-subhead", "Pending applications"));
    if (me.applications.length === 0) {
      wrap.append(el("p", "guild-hint", "No pending applications."));
    } else {
      for (const a of me.applications) wrap.append(applicationRow(a, false));
    }
  }

  wrap.append(el("h4", "guild-subhead", "Roster"));
  const roster = el("div", "guild-roster");
  for (const m of me.members) roster.append(memberRow(m, isLeader));
  wrap.append(roster);

  wrap.append(gvgSection(isLeader));

  if (isLeader) {
    wrap.append(el("p", "guild-hint", "Transfer leadership before you can leave."));
  } else {
    wrap.append(leaveButton());
  }

  return wrap;
}

function applicationRow(a, canAct) {
  const row = el("div", "guild-app-row guild-app-pending");
  row.append(el("span", "guild-app-name", a.name));
  if (a.message) row.append(el("span", "guild-app-msg", `"${a.message}"`));
  row.append(el("span", "guild-app-date", fmtDate(a.createdAt)));

  if (canAct) {
    const acceptBtn = button("Accept", "btn primary guild-small", async () => {
      acceptBtn.disabled = true;
      els.msgs.innerHTML = "";
      try {
        await acceptGuildApplication(a.id);
        pushMsg(`Accepted ${a.name}.`);
        await refresh();
      } catch (e) {
        pushMsg(e.message, true);
        acceptBtn.disabled = false;
      }
    });
    const rejectBtn = button("Reject", "btn ghost guild-small guild-danger", async () => {
      rejectBtn.disabled = true;
      els.msgs.innerHTML = "";
      try {
        await rejectGuildApplication(a.id);
        pushMsg(`Rejected ${a.name}.`);
        await refresh();
      } catch (e) {
        pushMsg(e.message, true);
        rejectBtn.disabled = false;
      }
    });
    row.append(acceptBtn, rejectBtn);
  }
  return row;
}

function memberRow(m, isLeader) {
  const row = el("div", "guild-mem-row");
  row.append(el("span", "guild-mem-name", m.name), badge(ROLE_LABEL[m.role] ?? m.role));
  row.append(el("span", "guild-mem-joined", `Joined ${fmtDate(m.joinedAt)}`));

  if (isLeader && m.role !== "leader") {
    const controls = el("div", "guild-mem-controls");
    controls.append(button("Kick", "btn ghost guild-small guild-danger", async () => {
      els.msgs.innerHTML = "";
      try {
        await kickGuildMember(m.trainerId);
        pushMsg(`Kicked ${m.name}.`);
        await refresh();
      } catch (e) {
        pushMsg(e.message, true);
      }
    }));

    if (m.role === "member") {
      controls.append(button("Promote to officer", "btn ghost guild-small", async () => {
        els.msgs.innerHTML = "";
        try {
          await promoteGuildMember(m.trainerId, "officer");
          pushMsg(`${m.name} is now an officer.`);
          await refresh();
        } catch (e) {
          pushMsg(e.message, true);
        }
      }));
    } else {
      controls.append(button("Demote to member", "btn ghost guild-small", async () => {
        els.msgs.innerHTML = "";
        try {
          await promoteGuildMember(m.trainerId, "member");
          pushMsg(`${m.name} is now a member.`);
          await refresh();
        } catch (e) {
          pushMsg(e.message, true);
        }
      }));
    }

    controls.append(button("Make leader", "btn ghost guild-small", async () => {
      if (!confirm(`Hand leadership to ${m.name}? You'll become an officer.`)) return;
      els.msgs.innerHTML = "";
      try {
        await transferGuildLeadership(m.trainerId);
        pushMsg(`${m.name} is now the leader.`);
        await refresh();
      } catch (e) {
        pushMsg(e.message, true);
      }
    }));

    row.append(controls);
  }
  return row;
}

function leaveButton() {
  return button("Leave guild", "btn ghost guild-small guild-danger", async () => {
    if (!confirm("Leave your guild?")) return;
    els.msgs.innerHTML = "";
    try {
      await leaveGuild();
      pushMsg("You left the guild.");
      await refresh();
    } catch (e) {
      pushMsg(e.message, true);
    }
  });
}

// ---------- GVG section (Phase 9.5) ----------

/** Same "registerable by time window, not just status" rule the server
 *  applies for team submission — status must also still be pre-war. */
function gvgWindowEnded(e) {
  return Date.now() > new Date(e.regEndsAt).getTime();
}

function gvgRegistrationOpenNow(e) {
  const now = Date.now();
  return now >= new Date(e.regStartsAt).getTime() && now <= new Date(e.regEndsAt).getTime();
}

function isGvgUpcoming(e) {
  return (e.status === "scheduled" || e.status === "registration") && !gvgWindowEnded(e);
}

// ---------- reward-line rendering (same shape as ui/tournament.js's own copy) ----------

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

// ---------- section shell: open events + history ----------

function gvgSection(isLeader) {
  const wrap = el("div", "gvg-section");
  wrap.append(el("h4", "guild-subhead", "⚔ Guild vs. Guild"));

  const open = gvgEvents.filter(isGvgUpcoming);
  const history = gvgEvents.filter((e) => !isGvgUpcoming(e));

  if (open.length === 0) {
    wrap.append(el("p", "guild-hint", "Nothing open for registration right now."));
  } else {
    for (const e of open) wrap.append(gvgOpenCard(e, isLeader));
  }

  if (history.length > 0) {
    wrap.append(el("h5", "guild-subhead", "History"));
    for (const e of history) wrap.append(gvgHistoryRow(e));
  }

  return wrap;
}

// ---------- open/upcoming card ----------

function gvgOpenCard(e, isLeader) {
  const card = el("div", "gvg-card");

  const head = el("div", "guild-head");
  head.append(el("b", null, e.name), badge(GVG_STATUS_LABEL[e.status] ?? e.status));
  card.append(head);

  if (e.description) card.append(el("p", "guild-desc", e.description));

  card.append(el("p", "guild-hint",
    `Registration: ${fmtDate(e.regStartsAt)} – ${fmtDate(e.regEndsAt)} · ${e.minTeams}-${e.maxTeams} teams` +
    ` · ${e.registeredGuildCount} guild${e.registeredGuildCount === 1 ? "" : "s"} registered`));

  const rewardLines = rewardsSummaryLines(e.rewards);
  if (rewardLines.length > 0) {
    const rewards = el("div", "gvg-rewards");
    for (const line of rewardLines) rewards.append(el("p", "gvg-reward-line", line));
    card.append(rewards);
  }

  if (!e.myTeam) {
    if (gvgRegistrationOpenNow(e)) {
      if (submittingId === e.id) {
        card.append(gvgSubmitPicker(e));
      } else {
        card.append(button("Submit team", "btn primary guild-small", () => openGvgSubmit(e.id)));
      }
    } else {
      card.append(el("p", "guild-hint", `Registration opens ${fmtDate(e.regStartsAt)}.`));
    }
  } else if (e.myTeam.battleOrder == null) {
    card.append(el("p", "guild-hint", "Submitted — awaiting your leader's pick."));
    if (gvgRegistrationOpenNow(e)) card.append(gvgWithdrawButton(e));
  } else {
    card.append(el("p", "guild-hint", `In your guild's lineup (slot ${e.myTeam.battleOrder}).`));
  }

  if (isLeader && Array.isArray(e.guildTeams)) card.append(gvgLineupSection(e));

  return card;
}

function gvgWithdrawButton(e) {
  const btn = button("Withdraw", "btn ghost guild-small guild-danger", async () => {
    btn.disabled = true;
    els.msgs.innerHTML = "";
    try {
      await withdrawGvgTeam(e.id);
      pushMsg(`Withdrew your team from ${e.name}.`);
      gvgRoster = null; // busy locks just changed — force a fresh read next time
      await refresh();
    } catch (err) {
      pushMsg(err.message, true);
      btn.disabled = false;
    }
  });
  return btn;
}

// ---------- submit flow: party picker (borrows ui/tournament.js's shape) ----------

async function openGvgSubmit(eventId) {
  submittingId = eventId;
  gvgPicks = [];
  if (!gvgRoster) {
    els.msgs.innerHTML = "";
    try {
      gvgRoster = await loadFarm();
    } catch (e) {
      pushMsg(`Could not load your roster: ${e.message}`, true);
      submittingId = null;
    }
  }
  renderBody();
}

function gvgSubmitPicker(e) {
  const wrap = el("div", "gvg-submit");
  wrap.append(el("h5", "guild-subhead", `Choose your team (${PARTY_SIZE}, in order — front first)`));

  if (!gvgRoster) {
    wrap.append(el("p", "guild-hint", "Loading…"));
    return wrap;
  }

  wrap.append(gvgPartyPicker());

  const confirmBtn = button("Submit team", "btn primary guild-small", async () => {
    confirmBtn.disabled = true;
    els.msgs.innerHTML = "";
    try {
      await submitGvgTeam(e.id, gvgPicks);
      pushMsg(`Submitted your team for ${e.name}.`);
      gvgRoster = null; // busy locks just changed — force a fresh read next time
      await refresh();
    } catch (err) {
      pushMsg(err.message, true);
      confirmBtn.disabled = false;
    }
  });
  confirmBtn.disabled = gvgPicks.length !== PARTY_SIZE;

  const cancelBtn = button("Cancel", "btn ghost guild-small", () => {
    submittingId = null;
    gvgPicks = [];
    renderBody();
  });

  const bar = el("div", "gvg-toolbar");
  bar.append(confirmBtn, cancelBtn);
  wrap.append(bar);
  return wrap;
}

function gvgPartyPicker() {
  const list = el("div", "gvg-mon-list");
  for (const m of gvgRoster.monsters) {
    const isBusy = m.busyUntil && new Date(m.busyUntil) > new Date();
    const pickIdx = gvgPicks.indexOf(m.id);
    const row = el("div", "gvg-mon" + (pickIdx !== -1 ? " picked" : "") + (isBusy ? " busy" : ""));
    row.append(el("span", "gvg-mon-emoji", m.emoji), el("span", "gvg-mon-name", m.name));
    if (isBusy) row.append(el("span", "gvg-mon-busy-tag", BUSY_LABEL[m.busyKind] ?? m.busyKind ?? "Busy"));
    if (pickIdx !== -1) row.append(el("span", "gvg-pick-badge", String(pickIdx + 1)));
    if (!isBusy) row.addEventListener("click", () => toggleGvgPick(m.id));
    list.append(row);
  }
  return list;
}

function toggleGvgPick(monsterId) {
  const i = gvgPicks.indexOf(monsterId);
  if (i !== -1) gvgPicks.splice(i, 1);
  else if (gvgPicks.length < PARTY_SIZE) gvgPicks.push(monsterId);
  renderBody();
}

// ---------- leader-only: lineup + register ----------

function gvgLineupSection(e) {
  const wrap = el("div", "gvg-lineup");
  wrap.append(el("h5", "guild-subhead", "Lineup"));

  const inputs = new Map(); // teamId -> its order <input>
  if (e.guildTeams.length === 0) {
    wrap.append(el("p", "guild-hint", "No teams submitted yet."));
  } else {
    for (const t of e.guildTeams) {
      const row = el("div", "gvg-lineup-row");
      const emoji = t.display?.[0]?.emoji;
      row.append(el("span", "gvg-lineup-name", emoji ? `${emoji} ${t.trainerName}` : t.trainerName));
      const input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.className = "gvg-order-input";
      input.value = t.battleOrder != null ? String(t.battleOrder) : "";
      row.append(input);
      wrap.append(row);
      inputs.set(t.teamId, input);
    }

    wrap.append(button("Save lineup", "btn ghost guild-small", async () => {
      els.msgs.innerHTML = "";
      try {
        // Build the ordered team-id list from whatever the leader actually
        // entered — blank inputs simply drop that team out of the lineup.
        // Everything else (count bounds, contiguity) is the server's call.
        const teamIds = [...inputs.entries()]
          .map(([teamId, input]) => ({ teamId, order: Number(input.value) }))
          .filter((x) => Number.isFinite(x.order) && x.order > 0)
          .sort((a, b) => a.order - b.order)
          .map((x) => x.teamId);
        await setGvgLineup(e.id, teamIds);
        pushMsg("Lineup saved.");
        await refresh();
      } catch (err) {
        pushMsg(err.message, true);
      }
    }));
  }

  if (e.guildRegistered) {
    wrap.append(badge("Registered ✓"));
  } else {
    wrap.append(button("Register guild", "btn primary guild-small", async () => {
      els.msgs.innerHTML = "";
      try {
        await registerGvgGuild(e.id);
        pushMsg(`${e.name}: guild registered.`);
        await refresh();
      } catch (err) {
        pushMsg(err.message, true);
      }
    }));
  }

  return wrap;
}

// ---------- history row ----------

function gvgHistoryRow(e) {
  const row = el("div", "gvg-history-row");
  row.append(
    el("span", "gvg-history-name", e.name),
    badge(GVG_STATUS_LABEL[e.status] ?? e.status, e.status === "cancelled" ? "gvg-cancelled" : undefined),
    el("span", "guild-hint", `${e.registeredGuildCount} guild${e.registeredGuildCount === 1 ? "" : "s"} registered`),
  );
  row.append(button("Details", "btn ghost guild-small", () => openGvgDetail(e.id)));
  return row;
}

// ---------- detail view: war bracket + standings (Phase 9.7) ----------

async function openGvgDetail(eventId) {
  gvgDetailId = eventId;
  gvgDetail = null;
  els.msgs.innerHTML = "";
  renderBody(); // show the "Loading…" state immediately
  try {
    gvgDetail = await fetchGvgDetail(eventId);
  } catch (e) {
    pushMsg(`Could not load GVG detail: ${e.message}`, true);
    gvgDetailId = null;
  }
  renderBody();
}

function backToGuild() {
  gvgDetailId = null;
  gvgDetail = null;
  renderBody();
}

/** "Round 1"/"Round 2".. for anything bigger, "Semifinals" for the one round
 *  with exactly 2 pairings, "Final" for the last round (always 1 pairing) —
 *  the exact ui/tournament.js roundLabel() rule, re-instantiated at guild
 *  level (a bracket entrant here is a registered GUILD, not a tournament
 *  entry). */
function gvgRoundLabel(round, idx) {
  if (round.pairings.length === 1) return "Final";
  if (round.pairings.length === 2) return "Semifinals";
  return `Round ${idx + 1}`;
}

/** guildId -> guild name (or "#id" fallback, "bye" for a null slot), reading
 *  only the detail response's own `guilds` list — never another endpoint. */
function gvgGuildLabel(guildId) {
  if (guildId == null) return "bye";
  const g = (gvgDetail.guilds ?? []).find((x) => x.guildId === guildId);
  return g ? g.guildName : `#${guildId}`;
}

/** gvg_teams id -> "trainerName" (or a "team #id" fallback when the id is
 *  missing from the response's `teams` map — never shown a lane). */
function gvgTeamLabel(teamId) {
  const t = gvgDetail.teams?.[teamId];
  return t?.trainerName ?? `team #${teamId}`;
}

function gvgSideSpan(guildId, winnerId) {
  if (guildId == null) return el("span", "gvg-pairing-side gvg-bye", "bye");
  const isWinner = winnerId != null && guildId === winnerId;
  return el("span", "gvg-pairing-side" + (isWinner ? " gvg-winner" : ""), gvgGuildLabel(guildId));
}

function gvgPairingRow(p) {
  const row = el("div", "gvg-pairing");
  row.append(gvgSideSpan(p.a, p.winner), el("span", "gvg-pairing-vs", "vs"), gvgSideSpan(p.b, p.winner));
  if (p.winner == null && p.a != null && p.b != null) row.append(el("span", "gvg-pairing-pending", "pending"));
  return row;
}

/** One battle summary line: "Battle N: <a>'s team vs <b>'s team — <winner>
 *  wins (X alive)", or "both teams fall" for a drawn battle — text only, no
 *  cutscene replay (CLAUDE.md §1.6, the Adventure precedent). */
function gvgBattleLine(b) {
  const a = gvgTeamLabel(b.teamA);
  const bside = gvgTeamLabel(b.teamB);
  if (b.outcome === "draw") return `Battle ${b.index + 1}: ${a}'s team vs ${bside}'s team — both teams fall`;
  const winner = b.outcome === "a" ? a : bside;
  const alive = b.outcome === "a" ? b.aAlive : b.bAlive;
  return `Battle ${b.index + 1}: ${a}'s team vs ${bside}'s team — ${winner} wins (${alive} alive)`;
}

/** One pairing's row plus (once played) its per-battle summary list and, on
 *  a simultaneous-exhaustion tiebreak, a note calling that out. */
function gvgPairingBlock(p) {
  const wrap = el("div", "gvg-pairing-block");
  wrap.append(gvgPairingRow(p));
  if (Array.isArray(p.battles) && p.battles.length) {
    const list = el("div", "gvg-battle-list");
    for (const b of p.battles) list.append(el("p", "gvg-battle-line", gvgBattleLine(b)));
    if (p.tiebreak) {
      list.append(el("p", "gvg-battle-line gvg-tiebreak",
        "Both sides exhausted their lineup at once — a coin flip broke the tie."));
    }
    wrap.append(list);
  }
  return wrap;
}

function gvgRoundBlock(round, idx) {
  const block = el("div", "gvg-round");
  block.append(el("h5", "guild-subhead", gvgRoundLabel(round, idx)));
  for (const p of round.pairings) block.append(gvgPairingBlock(p));
  return block;
}

function gvgStandingsList(standings) {
  const list = el("div", "gvg-standings");
  for (const s of standings) {
    const row = el("div", "gvg-standing-row" + (s.guildId === gvgDetail.myGuildId ? " gvg-standing-mine" : ""));
    row.append(el("span", "gvg-standing-rank", `#${s.rank}`));
    row.append(el("span", "gvg-standing-name", s.guildName ?? `#${s.guildId}`));
    list.append(row);
    for (const r of s.rewards ?? []) {
      const rewardRow = el("div", "gvg-standing-reward-row");
      const rewardLine = r.reward?.rewards?.length ? rewardListText(r.reward.rewards) : "—";
      rewardRow.append(el("span", "gvg-standing-reward-name", r.trainerName ?? `#${r.trainerId}`));
      rewardRow.append(el("span", "gvg-standing-reward", rewardLine));
      list.append(rewardRow);
    }
  }
  return list;
}

function gvgDetailView() {
  const e = gvgDetail.event;
  const wrap = el("div", "gvg-detail");

  const head = el("div", "guild-head");
  head.append(
    el("b", null, e.name),
    badge(GVG_STATUS_LABEL[e.status] ?? e.status, e.status === "cancelled" ? "gvg-cancelled" : undefined),
  );
  wrap.append(head);
  if (e.status === "cancelled") wrap.append(el("p", "guild-hint gvg-cancelled-note", "This GVG event was cancelled."));
  if (e.description) wrap.append(el("p", "guild-desc", e.description));
  wrap.append(el("p", "guild-hint",
    `${e.minTeams}-${e.maxTeams} teams · ${e.registeredGuildCount} guild${e.registeredGuildCount === 1 ? "" : "s"} registered`));

  if (gvgDetail.rounds && gvgDetail.rounds.length) {
    wrap.append(el("h4", "guild-subhead", "Bracket"));
    gvgDetail.rounds.forEach((round, idx) => wrap.append(gvgRoundBlock(round, idx)));
    if (gvgDetail.thirdPlace) {
      const block = el("div", "gvg-round");
      block.append(el("h5", "guild-subhead", "3rd-place war"), gvgPairingBlock(gvgDetail.thirdPlace));
      wrap.append(block);
    }
  } else {
    wrap.append(el("p", "guild-hint", "The war bracket hasn't started yet."));
  }

  if (gvgDetail.standings && gvgDetail.standings.length) {
    wrap.append(el("h4", "guild-subhead", "Standings"));
    wrap.append(gvgStandingsList(gvgDetail.standings));
  }

  wrap.append(button("Back", "btn ghost guild-small", backToGuild));
  return wrap;
}
