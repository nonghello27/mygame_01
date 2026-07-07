// Guild panel (Phase 9.4). Same tab-less panel shell as ui/tournament.js /
// ui/summon.js (a msgs div + a body div, one refresh() that re-reads and
// re-renders) — no state of its own beyond what fetchGuildMe()/
// fetchGuildBrowse() just returned.
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

import {
  fetchGuildBrowse, fetchGuildMe, createGuild, applyGuild, acceptGuildApplication,
  rejectGuildApplication, leaveGuild, kickGuildMember, promoteGuildMember,
  transferGuildLeadership,
} from "../services/content.js";

const CREATE_COST_LABEL = "500 🪙"; // mirrors GUILD_CREATE_COST server/services/guild.js

let els = null;
let me = null;          // last fetchGuildMe() result
let guilds = null;      // last fetchGuildBrowse() result's `guilds`, loaded lazily (guildless only)

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
  try {
    me = await fetchGuildMe();
    if (!me.guild) guilds = (await fetchGuildBrowse()).guilds;
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
