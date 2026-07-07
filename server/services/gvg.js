// GVG event use-cases (Phase 9.5: schedule, team submission, lineup) — the
// tournament event lifecycle re-instantiated at guild level. Setup-side ONLY
// this phase: no bracket, no battles (Phase 9.7 lands those). What IS lazy
// here is openGvgRegistrationWindows (the cosmetic scheduled -> registration
// flip) plus the window-close lock release — settleGvgSetup(sql), called at
// the top of every read, brings both up to date, same "lazy settle on read"
// precedent as settleTournaments/settleActivities/ensureSeason.
//
// The client contributes only choices — an eventId, a 3-monster
// monsterIds pick, or an ordered teamIds list — everything else (the busy-
// lock claim, the frozen team snapshot, role checks, lineup validity) is
// decided/validated against DB state HERE, never trusted from the request
// body (CLAUDE.md §1.1). The caller's guild/role is always re-read via
// getMembership() first, exactly like server/services/guild.js's every
// write does — never trusted from the body either.
//
// Team submission follows the exact claim-first-then-pay + LIFO-compensation
// shape server/services/tournament.js's register() set, minus the fee leg
// (GVG events have none): (a) claim the party's busy lock, (b) freeze the
// team snapshot, (c) insert the team row — any failure from a given step
// onward undoes every earlier step, in reverse.
//
// Window-close release (settleGvgSetup, below) frees every submitted-but-
// unpicked team's locks, AND every team of a guild that never completed
// registration at all — nobody stays locked for a lineup that never fought.
// A picked team belonging to a REGISTERED guild is deliberately left locked
// here — 9.7's war resolution is what eventually releases those, once their
// battles are actually played.

import { httpError } from "../http.js";
import {
  insertGvgEvent, listGvgEventsWithCounts, getGvgEventById, claimCancelGvgEvent,
  openGvgRegistrationWindows, listDueGvgEvents,
  insertGvgTeam, getMyGvgTeam, listGvgTeamsForGuild, listMyGvgTeamsByEvent,
  claimWithdrawGvgTeam, claimPartyForGvg, releaseGvgParty,
  clearGvgLineup, setGvgTeamOrder,
  insertGvgRegistration, listGvgRegistrationsByGuild,
  claimReleaseGvgTeam, listUnreleasedTeamsForEvent, listUnreleasedUnpickedTeamsForEvent,
} from "../repos/gvg.js";
import { getMembership } from "../repos/guilds.js";
import { listMonstersByTrainer } from "../repos/monsters.js";
import { listEquippedMonsterEquipment } from "../repos/equipment.js";
import { listSocketedRunes } from "../repos/runes.js";
import { toLane, groupByMonster } from "./matches.js";
import { settleActivities } from "./activities.js";
import { validateGvgEvent } from "./adminValidate.js";
import {
  listSpeciesAdmin, listItemsAdmin, listEquipmentAdmin, listRunesAdmin,
} from "../repos/admin.js";

export const PARTY_SIZE = 3;

// Team submission (and guild registration) is open purely by TIME WINDOW,
// not by status — same reasoning as server/services/tournament.js's own
// REGISTRABLE_STATUSES/withinWindow (copied locally here rather than
// imported: each event-lifecycle service owns its own small copy, same
// precedent tournament.js itself set for guild.js's role-check helpers).
const REGISTRABLE_STATUSES = ["scheduled", "registration"];

function withinWindow(event) {
  const now = Date.now();
  return now >= new Date(event.regStartsAt).getTime() && now <= new Date(event.regEndsAt).getTime();
}

function validatePartyIds(monsterIds) {
  if (!Array.isArray(monsterIds) || monsterIds.length !== PARTY_SIZE) {
    throw httpError(400, `monsterIds must be exactly ${PARTY_SIZE} monster ids`);
  }
  const ids = monsterIds.map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw httpError(400, "monsterIds must be integer monster ids");
  }
  if (new Set(ids).size !== ids.length) {
    throw httpError(400, `monsterIds must be ${PARTY_SIZE} distinct monsters`);
  }
  return ids;
}

/** {teamId, monsterIds, battleOrder, submittedAt}, or null — the caller's own
 *  submission summary, NEVER the lanes snapshot (CLAUDE.md §1.1). */
function toTeamSummary(team) {
  if (!team) return null;
  return { teamId: team.id, monsterIds: team.monsterIds, battleOrder: team.battleOrder, submittedAt: team.submittedAt };
}

/** {teamId, trainerId, trainerName, display, battleOrder, submittedAt} — the
 *  leader-only pick-list shape: display data only, never lanes. */
function toGuildTeamView(team) {
  return {
    teamId: team.id, trainerId: team.trainerId, trainerName: team.trainerName,
    display: team.team.display, battleOrder: team.battleOrder, submittedAt: team.submittedAt,
  };
}

// --- player-facing: list / submit / withdraw ----------------------------------

/**
 * Every GVG event (any status — cancelled/past stay visible as history),
 * newest first, with a live registered-guild count, the caller's OWN team
 * summary, and — only while the caller is in a guild — whether that guild
 * has registered. A guild's LEADER additionally sees every team their guild
 * has submitted (display info only, CLAUDE.md §1.1 — a plain member never
 * sees the pick queue, mirroring guild.js's me()'s applications gate).
 */
export async function listGvgEvents(sql, trainerId) {
  await settleGvgSetup(sql);

  const membership = await getMembership(sql, trainerId);
  const [events, myTeams] = await Promise.all([
    listGvgEventsWithCounts(sql),
    listMyGvgTeamsByEvent(sql, trainerId),
  ]);
  const registrations = membership ? await listGvgRegistrationsByGuild(sql, membership.guildId) : new Map();
  const isLeader = membership?.role === "leader";

  return {
    membership: membership ? { guildId: membership.guildId, role: membership.role } : null,
    events: await Promise.all(events.map(async (e) => {
      const out = {
        id: e.id,
        name: e.name,
        description: e.description,
        regStartsAt: e.regStartsAt,
        regEndsAt: e.regEndsAt,
        status: e.status,
        minTeams: e.minTeams,
        maxTeams: e.maxTeams,
        rewards: e.rewards,
        registeredGuildCount: e.registeredGuildCount,
        myTeam: toTeamSummary(myTeams.get(e.id)),
      };
      if (membership) out.guildRegistered = registrations.has(e.id);
      // One query per event for the leader's pick list — the event count is
      // small (an admin-created instance table, not a per-trainer one), so
      // this stays simple rather than folding it into one bulk query.
      if (isLeader) {
        const guildTeams = await listGvgTeamsForGuild(sql, e.id, membership.guildId);
        out.guildTeams = guildTeams.map(toGuildTeamView);
      }
      return out;
    })),
  };
}

/**
 * Submit exactly 3 owned, free monsters as one team for a GVG event: claim
 * the party's busy lock, freeze the team snapshot (toLane()/groupByMonster —
 * the EXACT tournament_entries.team / adventure_sessions.party shape), and
 * insert the team row under the caller's CURRENT guild. Any failure
 * compensates: a partial party claim releases only what it claimed; a
 * failure after a full claim releases the whole party.
 * @param {{eventId:number, monsterIds:number[]}} body
 */
export async function submitTeam(sql, trainerId, body) {
  const membership = await getMembership(sql, trainerId);
  if (!membership) throw httpError(409, "join a guild first");

  const id = Number(body?.eventId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "eventId must be a GVG event's id");
  const event = await getGvgEventById(sql, id);
  if (!event) throw httpError(404, "unknown GVG event");
  if (!REGISTRABLE_STATUSES.includes(event.status) || !withinWindow(event)) {
    throw httpError(409, "team submission is not open");
  }

  const ids = validatePartyIds(body?.monsterIds);

  // Free anything that finished first (the register()/createMatch/adventure
  // start() precedent), so a monster that has actually come home isn't
  // blocked by a stale busy_until.
  await settleActivities(sql, trainerId);

  // (a) the party busy-claim. A partial claim (fewer than PARTY_SIZE rows)
  // must release what it DID claim — never leave a monster locked with
  // nothing to show for it.
  const claimed = await claimPartyForGvg(sql, trainerId, ids);
  if (claimed.length !== ids.length) {
    if (claimed.length > 0) await releaseGvgParty(sql, trainerId, claimed);
    throw httpError(409, "a monster is busy or not yours");
  }

  try {
    // (b) freeze the team snapshot: the trainer's own monsters, in the
    // chosen order, joined with equipped monster-domain gear and socketed
    // runes — same toLane() shape tournament register()/adventure start()
    // freeze for their own parties.
    const roster = await listMonstersByTrainer(sql, trainerId);
    const byId = new Map(roster.map((m) => [m.id, m]));
    const chosen = ids.map((mid) => byId.get(mid));
    if (chosen.some((m) => !m)) throw httpError(404, "monster not found");

    const equipByMonster = groupByMonster(await listEquippedMonsterEquipment(sql, trainerId));
    const runesByMonster = groupByMonster(await listSocketedRunes(sql, trainerId));
    const lanes = chosen.map((m, i) =>
      toLane(m, i, equipByMonster.get(m.id) ?? [], runesByMonster.get(m.id) ?? [])
    );
    const display = chosen.map((m) => ({ monsterId: m.id, name: m.name, emoji: m.emoji }));

    // (c) the team insert. UNIQUE(event_id, trainer_id) is the double-submit
    // guard — a race loses this INSERT as a 23505.
    const team = await insertGvgTeam(sql, {
      eventId: id, guildId: membership.guildId, trainerId, team: { lanes, display }, monsterIds: ids,
    });
    return { team: toTeamSummary(team) };
  } catch (err) {
    // Everything from (a) onward is undone here: release the party (the only
    // thing there is to compensate — no fee to refund, unlike tournaments).
    await releaseGvgParty(sql, trainerId, ids);
    if (err.code === "23505") throw httpError(409, "you already submitted a team for this event");
    throw err;
  }
}

/**
 * Withdraw a submitted-but-unpicked team while the window is still open: the
 * guarded DELETE (claimWithdrawGvgTeam) is the claim itself. On a lost claim,
 * a re-read of the caller's own team is DIAGNOSTICS ONLY (the market.js
 * "diagnostics vs. gate" split) — it distinguishes "your team is picked, ask
 * your leader" from "you have no team at all", but never itself decides
 * whether the withdraw succeeds.
 */
export async function withdrawTeam(sql, trainerId, body) {
  const id = Number(body?.eventId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "eventId must be a GVG event's id");
  const event = await getGvgEventById(sql, id);
  if (!event) throw httpError(404, "unknown GVG event");
  if (!REGISTRABLE_STATUSES.includes(event.status) || !withinWindow(event)) {
    throw httpError(409, "team submission is closed");
  }

  const team = await claimWithdrawGvgTeam(sql, id, trainerId);
  if (!team) {
    const existing = await getMyGvgTeam(sql, id, trainerId);
    if (existing && existing.battleOrder != null) {
      throw httpError(409, "your team is in the guild's lineup — ask your leader to unpick it first");
    }
    throw httpError(404, "you have no team submitted for this event");
  }

  await releaseGvgParty(sql, trainerId, team.monsterIds);
  return { withdrawn: true };
}

// --- leader actions: lineup / register ----------------------------------------

/**
 * Set (replace) the guild's whole lineup for one event: the leader picks
 * which submitted teams fight and in what order. Two steps, deliberately NOT
 * atomic — clearGvgLineup() then one setGvgTeamOrder() per id — because the
 * only writer of a guild's lineup is that guild's single leader, and the
 * partial-unique index (gvg_teams_lineup_slot_idx) backs slot uniqueness
 * regardless; a failure mid-loop just leaves a partial lineup the leader
 * simply re-sets, and registerGuild() re-validates the lineup's shape from
 * scratch anyway, so a broken lineup can never register.
 * @param {{eventId:number, teamIds:number[]}} body ordered team ids, 1-based
 */
export async function setLineup(sql, trainerId, body) {
  const membership = await getMembership(sql, trainerId);
  if (!membership || membership.role !== "leader") throw httpError(403, "leader only");

  const id = Number(body?.eventId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "eventId must be a GVG event's id");
  const event = await getGvgEventById(sql, id);
  if (!event) throw httpError(404, "unknown GVG event");
  if (!REGISTRABLE_STATUSES.includes(event.status) || !withinWindow(event)) {
    throw httpError(409, "the registration window is closed");
  }

  const teamIds = body?.teamIds;
  if (!Array.isArray(teamIds) || teamIds.length === 0) throw httpError(400, "teamIds must be a non-empty array");
  // minTeams is enforced at register(), not here — a leader may stage a
  // partial lineup before the guild is ready to register.
  if (teamIds.length > event.maxTeams) throw httpError(400, `teamIds must be at most ${event.maxTeams}`);
  const ids = teamIds.map(Number);
  if (ids.some((tid) => !Number.isInteger(tid) || tid <= 0)) throw httpError(400, "teamIds must be integer team ids");
  if (new Set(ids).size !== ids.length) throw httpError(400, "teamIds must be distinct team ids");

  const guildTeams = await listGvgTeamsForGuild(sql, id, membership.guildId);
  const ownTeamIds = new Set(guildTeams.filter((t) => !t.released).map((t) => t.id));
  for (const tid of ids) {
    if (!ownTeamIds.has(tid)) throw httpError(400, `teamId ${tid} is not one of your guild's submitted teams`);
  }

  await clearGvgLineup(sql, id, membership.guildId);
  for (let i = 0; i < ids.length; i++) {
    await setGvgTeamOrder(sql, id, membership.guildId, ids[i], i + 1);
  }

  const refreshed = await listGvgTeamsForGuild(sql, id, membership.guildId);
  return { guildTeams: refreshed.map(toGuildTeamView) };
}

/**
 * Register the guild for a GVG event: requires a valid ordered lineup
 * already staged (setLineup) — team count within [minTeams, maxTeams] and
 * battleOrder exactly contiguous 1..n. UNIQUE(event_id, guild_id) is the
 * double-register guard — a race registering twice loses this INSERT as a
 * 23505.
 * @param {{eventId:number}} body
 */
export async function registerGuild(sql, trainerId, body) {
  const membership = await getMembership(sql, trainerId);
  if (!membership || membership.role !== "leader") throw httpError(403, "leader only");

  const id = Number(body?.eventId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "eventId must be a GVG event's id");
  const event = await getGvgEventById(sql, id);
  if (!event) throw httpError(404, "unknown GVG event");
  if (!REGISTRABLE_STATUSES.includes(event.status) || !withinWindow(event)) {
    throw httpError(409, "registration is not open");
  }

  const guildTeams = await listGvgTeamsForGuild(sql, id, membership.guildId);
  const lineup = guildTeams.filter((t) => t.battleOrder != null).sort((a, b) => a.battleOrder - b.battleOrder);
  const n = lineup.length;
  const contiguous = lineup.every((t, i) => t.battleOrder === i + 1);
  if (n < event.minTeams || n > event.maxTeams || !contiguous) {
    throw httpError(409, `set a lineup of ${event.minTeams}-${event.maxTeams} teams first`);
  }

  try {
    await insertGvgRegistration(sql, { eventId: id, guildId: membership.guildId, registeredBy: trainerId });
  } catch (err) {
    if (err.code === "23505") throw httpError(409, "your guild is already registered");
    throw err;
  }

  return { registered: true, lineup: lineup.map((t) => t.id) };
}

// --- admin: create / cancel / list ------------------------------------------

/**
 * Validate + mint a new GVG event. Status ALWAYS starts 'scheduled' — the
 * scheduled -> registration walk is settleGvgSetup()'s job (running ->
 * completed is 9.7's). The seed is minted here (the tournament adminCreate
 * precedent) so the eventual war bracket is replayable from this row alone.
 */
export async function adminCreate(sql, input) {
  const [species, items, equipment, runes] = await Promise.all([
    listSpeciesAdmin(sql), listItemsAdmin(sql), listEquipmentAdmin(sql), listRunesAdmin(sql),
  ]);
  const lookups = {
    itemIds: new Set(items.map((i) => i.id)),
    equipmentDefIds: new Set(equipment.map((e) => e.id)),
    runeDefIds: new Set(runes.map((r) => r.id)),
    speciesIds: new Set(species.map((s) => s.id)),
  };
  const e = validateGvgEvent(input, lookups);
  const seed = Math.floor(Math.random() * 0x7fffffff);
  return insertGvgEvent(sql, { ...e, seed });
}

/**
 * The release walk shared by BOTH admin cancel (full release, every team) and
 * settleGvgSetup's window-close pass (a narrower, unpicked-only release) —
 * this variant, used by adminCancel, always walks EVERY not-yet-released
 * team for the event. Idempotent / safe re-run: claimReleaseGvgTeam only
 * returns a row (and only THEN do we release a lock) for a team that hasn't
 * been released yet, so re-invoking this on an already-cancelled event only
 * ever finishes the remainder — never double-releases.
 */
async function releaseAllCore(sql, event) {
  const teams = await listUnreleasedTeamsForEvent(sql, event.id);
  for (const team of teams) {
    const claimed = await claimReleaseGvgTeam(sql, team.id);
    if (!claimed) continue; // already released by an earlier cancel attempt
    await releaseGvgParty(sql, claimed.trainerId, claimed.monsterIds);
  }
  return event;
}

/**
 * Cancel at ANY non-completed status: releases every team's locks (picked or
 * not), pays nothing (there is nothing to refund), and keeps the row visible
 * in history. Same two-step shape as server/services/tournament.js's
 * adminCancel: the status flip only runs once (an already-'cancelled' event
 * skips straight to releaseAllCore rather than re-claiming a status it
 * already has); 'completed' is the one true dead end.
 */
export async function adminCancel(sql, eventId) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "eventId must be a GVG event's id");

  const before = await getGvgEventById(sql, id);
  if (!before) throw httpError(404, "unknown GVG event");
  if (before.status === "completed") throw httpError(409, "cannot cancel a completed GVG event");

  let event = before;
  if (before.status !== "cancelled") {
    const claimed = await claimCancelGvgEvent(sql, id);
    // A lost claim here means a concurrent request already moved it to a
    // terminal status between our read and this UPDATE — re-read to give an
    // accurate message rather than assuming which one.
    if (!claimed) {
      const now = await getGvgEventById(sql, id);
      throw httpError(409, `GVG event is already ${now?.status ?? "resolved"}`);
    }
    event = claimed;
  }

  return releaseAllCore(sql, event);
}

/** All GVG events + registered-guild counts, for the admin tab (same read as
 *  the player list, minus the per-caller membership view). */
export async function adminList(sql) {
  await settleGvgSetup(sql);
  return { events: await listGvgEventsWithCounts(sql) };
}

// --- lazy settlement (Phase 9.5's setup-side slice) ---------------------------

/**
 * The lazy-time entry point (CLAUDE.md §1.5): called at the top of every GVG
 * read. Cosmetically opens any window that's actually started, then — for
 * every event whose window has closed but hasn't (yet, or ever, this phase)
 * advanced past 'registration' — releases every submitted-but-unpicked
 * team's lock, plus every team belonging to a guild that never completed
 * registration. A single event's release pass failing (a transient DB
 * hiccup) is logged and skipped rather than allowed to break every OTHER
 * event's read — the next read's pass simply tries it again.
 */
export async function settleGvgSetup(sql) {
  await openGvgRegistrationWindows(sql);
  const due = await listDueGvgEvents(sql);
  for (const event of due) {
    try {
      const teams = await listUnreleasedUnpickedTeamsForEvent(sql, event.id);
      for (const team of teams) {
        const claimed = await claimReleaseGvgTeam(sql, team.id);
        if (!claimed) continue; // already released by an earlier pass
        await releaseGvgParty(sql, claimed.trainerId, claimed.monsterIds);
      }
    } catch (err) {
      console.error(`settleGvgSetup: GVG event ${event.id} failed to settle:`, err);
    }
  }
}
