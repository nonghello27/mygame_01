// GVG event use-cases (Phase 9.5: schedule, team submission, lineup; Phase
// 9.7: war resolution, rewards, results) — the tournament event lifecycle
// re-instantiated at guild level, all the way through. settleGvg(sql),
// called at the top of every read, brings an event fully up to date: the
// cosmetic scheduled -> registration flip, the window-close lock release
// 9.5 already had, AND (9.7) the running -> completed walk — one round of
// guild-vs-guild wars resolved per settlement pass, exactly like
// server/services/tournament.js's settleTournaments()/settleRunning() —
// same "lazy settle on read" precedent as settleActivities/ensureSeason.
//
// The client contributes only choices — an eventId, a 3-monster
// monsterIds pick, or an ordered teamIds list — everything else (the busy-
// lock claim, the frozen team snapshot, role checks, lineup validity, the
// ENTIRE war bracket, every war, every reward) is decided/validated/resolved
// against DB state HERE, never trusted from the request body (CLAUDE.md
// §1.1). The caller's guild/role is always re-read via getMembership() first,
// exactly like server/services/guild.js's every write does — never trusted
// from the body either.
//
// Team submission follows the exact claim-first-then-pay + LIFO-compensation
// shape server/services/tournament.js's register() set, minus the fee leg
// (GVG events have none): (a) claim the party's busy lock, (b) freeze the
// team snapshot, (c) insert the team row — any failure from a given step
// onward undoes every earlier step, in reverse.
//
// Window-close release (settleWindowClose, below) frees every submitted-but-
// unpicked team's locks, AND every team of a guild that never completed
// registration at all — nobody stays locked for a lineup that never fought.
// A picked team belonging to a REGISTERED guild is deliberately left locked
// there — settleRunningGvg (below) is what eventually releases those, the
// instant the guild is ELIMINATED (not the whole event's end).
//
// --- war resolution (Phase 9.7) ---------------------------------------------
//
// settleRunningGvg(sql, event) mirrors server/services/tournament.js's
// settleRunning() almost verbatim: re-derive the guild bracket PURELY from
// (this event's REGISTERED guild ids ordered by registration id ASC,
// gvg_events.seed, and the gvg_wars rows already resolved) via
// shared/rules/bracket.js's replayBracket() — CLAUDE.md §1.6, there is no
// bracket JSONB column anywhere; gvg_wars is the sole durable record. If
// incomplete: resolve exactly ONE round this pass — every real, undecided
// pairing in the bracket's current round (skip byes — no gvg_wars row for
// one, the tournament precedent), plus the 3rd-place decider once the final
// round exists — each pairing a WAR, not a single battle: both guilds'
// PICKED lineups (server/repos/gvg.js's listLineupTeamsForGuildEvent) feed
// shared/rules/gvgWar.js's resolveWarRelay(), seeded by
// derivePairingSeed(event.seed, round, position) exactly like a tournament
// pairing. A war's result persists via the exactly-once insertGvgWar() claim
// (`UNIQUE(event_id, round, position)`; a lost claim just means another
// settlement pass already computed the identical winner, since a war is
// fully deterministic from its own seed + the two guilds' frozen lineups —
// skip re-writing it). THEN — immediately, not waiting for the whole event
// to finish — the LOSING guild's every lineup team's lock is released
// (claimReleaseGvgTeam + releaseGvgParty, both idempotent): the ROADMAP's
// locked design decision, "locks release on the guild's elimination, not the
// event's end." Once the bracket, re-derived after this pass, comes back
// `complete`: placements() -> shared/rules/rewards.js's resolveRewards()
// against this event's configured rewards; rewards follow CONTRIBUTION, not
// mere membership (another locked design decision) — every ranked guild's
// FULL lineup (not its whole roster) gets that rank's rewards, one
// idempotent claimGvgTeamReward() PER TEAM (`reward IS NULL` is the gate,
// 018's claimEntryReward precedent), granting through the SHARED
// REWARD_GRANTERS registry (server/services/eventRewards.js — lifted out of
// tournament.js the moment a second caller needed it) and releasing that
// team's lock (a no-op for an already-eliminated guild's teams, released
// earlier above — this call is what finally frees the champion's). Only
// once every ranked guild's every team is stamped: claimCompleteGvgEvent
// flips running -> completed with the standings JSONB. Admin cancel
// mid-'running' still works exactly as 9.5 designed it: whichever guarded
// status flip lands first wins the race.

import { httpError } from "../http.js";
import {
  insertGvgEvent, listGvgEventsWithCounts, getGvgEventById, claimCancelGvgEvent,
  openGvgRegistrationWindows, listDueGvgEvents, claimStartGvgEvent, claimCompleteGvgEvent,
  insertGvgTeam, getMyGvgTeam, listGvgTeamsForGuild, listMyGvgTeamsByEvent,
  claimWithdrawGvgTeam, claimPartyForGvg, releaseGvgParty,
  clearGvgLineup, setGvgTeamOrder,
  insertGvgRegistration, listGvgRegistrationsByGuild, listGvgRegistrationsForEvent,
  claimReleaseGvgTeam, listUnreleasedTeamsForEvent, listUnreleasedUnpickedTeamsForEvent,
  listLineupTeamsForGuildEvent, claimGvgTeamReward, insertGvgWar, listWarsForEvent,
} from "../repos/gvg.js";
import { getMembership } from "../repos/guilds.js";
import { listMonstersByTrainer } from "../repos/monsters.js";
import { listEquippedMonsterEquipment } from "../repos/equipment.js";
import { listSocketedRunes } from "../repos/runes.js";
import { toLane, groupByMonster } from "./matches.js";
import { settleActivities } from "./activities.js";
import { validateGvgEvent } from "./adminValidate.js";
import { REWARD_GRANTERS } from "./eventRewards.js";
import {
  listSpeciesAdmin, listItemsAdmin, listEquipmentAdmin, listRunesAdmin,
} from "../repos/admin.js";
import { resolveWarRelay } from "../../shared/rules/gvgWar.js";
import { replayBracket, derivePairingSeed, placements } from "../../shared/rules/bracket.js";
import { resolveRewards } from "../../shared/rules/rewards.js";

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
  await settleGvg(sql);

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
 * scheduled -> registration -> running -> completed walk is entirely
 * settleGvg()'s job on later reads. The seed is minted here (the tournament
 * adminCreate precedent) so the eventual war bracket is replayable from this
 * row alone.
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
 * settleWindowClose's window-close pass (a narrower, unpicked-only release)
 * — this variant, used by adminCancel, always walks EVERY not-yet-released
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
  await settleGvg(sql);
  return { events: await listGvgEventsWithCounts(sql) };
}

// --- GVG event detail: bracket + standings (Phase 9.7) ----------------------

/**
 * Everything the detail view needs and NOTHING more (CLAUDE.md §1.1 — never
 * another guild's lanes): the event summary, every registered guild's public
 * display info (id + name), a `teams` map (gvg_teams id -> {guildId,
 * trainerId, trainerName, display}) so the UI can label a bracket pairing's
 * per-battle lines without ever seeing lanes, the war bracket re-derived
 * round by round with each pairing's seed/per-battle summary/tiebreak flag,
 * the 3rd-place pairing (same shape), the enriched standings (guild name +
 * each of its lineup teams' teamId/trainer/stamped reward), and the
 * CALLER's own guild id (null when guildless). Mirrors
 * server/services/tournament.js's getTournamentDetail almost exactly, with
 * "entry" replaced by "registered guild" throughout. Every registered
 * guild's lineup is read exactly ONCE here (`lineupsByGuild`) and reused for
 * both the `teams` map and the standings' reward lines, rather than a
 * second read per standings row. Settlement runs first (the lazy hook), so
 * this always reflects the freshest possible state.
 */
export async function getGvgDetail(sql, trainerId, eventId) {
  await settleGvg(sql);

  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "eventId must be a GVG event's id");
  const event = await getGvgEventById(sql, id);
  if (!event) throw httpError(404, "unknown GVG event");

  const [registrations, membership] = await Promise.all([
    listGvgRegistrationsForEvent(sql, id),
    getMembership(sql, trainerId),
  ]);

  let rounds = null;
  let thirdPlace = null;
  // Only attempt a replay once a bracket could plausibly exist: at least 2
  // registered guilds, AND either the event has actually started running at
  // some point (there's a gvg_wars row) or it's running/completed right now
  // — the getTournamentDetail precedent exactly.
  if (registrations.length >= 2) {
    const wars = await listWarsForEvent(sql, id);
    if (wars.length > 0 || event.status === "running" || event.status === "completed") {
      const entrantIds = registrations.map((r) => String(r.guildId));
      const { bracket } = replayBracket(entrantIds, event.seed, toWarResultLog(wars));
      const warBySpot = new Map(wars.map((w) => [`${w.round}:${w.position}`, w]));

      rounds = bracket.rounds.map((round, roundIdx) => ({
        pairings: round.pairings.map((p, pos) => toPairingView(p, warBySpot.get(`${roundIdx}:${pos}`))),
      }));

      if (bracket.thirdPlace) {
        const finalRoundIdx = bracket.rounds.length - 1;
        thirdPlace = toPairingView(bracket.thirdPlace, warBySpot.get(`${finalRoundIdx}:1`));
      }
    }
  }

  const guildNameById = new Map(registrations.map((r) => [r.guildId, r.guildName]));

  // One lineup read per REGISTERED guild, reused below for both the `teams`
  // display map (bracket/battle-summary labels) and the standings' per-team
  // reward lines — never a second read per standings row.
  const lineupsByGuild = new Map(
    await Promise.all(
      registrations.map(async (r) => [r.guildId, await listLineupTeamsForGuildEvent(sql, id, r.guildId)]),
    ),
  );

  const teams = {};
  for (const [guildId, lineupTeams] of lineupsByGuild) {
    for (const t of lineupTeams) {
      teams[t.id] = { guildId, trainerId: t.trainerId, trainerName: t.trainerName, display: t.team.display };
    }
  }

  const standings = [];
  for (const s of event.standings ?? []) {
    const lineupTeams = lineupsByGuild.get(s.guildId) ?? [];
    standings.push({
      rank: s.rank,
      guildId: s.guildId,
      guildName: guildNameById.get(s.guildId) ?? null,
      rewards: lineupTeams.map((t) => ({
        teamId: t.id, trainerId: t.trainerId, trainerName: t.trainerName, reward: t.reward,
      })),
    });
  }

  return {
    event: {
      id: event.id,
      name: event.name,
      description: event.description,
      regStartsAt: event.regStartsAt,
      regEndsAt: event.regEndsAt,
      status: event.status,
      minTeams: event.minTeams,
      maxTeams: event.maxTeams,
      rewards: event.rewards,
      registeredGuildCount: registrations.length,
    },
    guilds: registrations.map((r) => ({ guildId: r.guildId, guildName: r.guildName })),
    teams,
    rounds,
    thirdPlace,
    standings,
    myGuildId: membership ? membership.guildId : null,
  };
}

/** One bracket pairing shaped for the detail view: guild ids as numbers, plus
 *  its war's seed/per-battle summary/tiebreak flag (null when unplayed). */
function toPairingView(p, war) {
  return {
    a: p.a == null ? null : Number(p.a),
    b: p.b == null ? null : Number(p.b),
    winner: p.winner == null ? null : Number(p.winner),
    seed: war ? war.seed : null,
    battles: war ? war.results?.battles ?? null : null,
    tiebreak: war ? Boolean(war.results?.tiebreak) : false,
  };
}

// --- lazy settlement (Phase 9.5's setup slice + Phase 9.7's war engine) -----

/**
 * The lazy-time entry point (CLAUDE.md §1.5): called at the top of every GVG
 * read. Cosmetically opens any window that's actually started, then brings
 * every due event fully up to date, one at a time. A single event's
 * settlement failing (an unregistered reward type, a transient DB hiccup) is
 * logged and skipped rather than allowed to break every OTHER event's read —
 * the next read's pass simply tries it again.
 */
export async function settleGvg(sql) {
  await openGvgRegistrationWindows(sql);
  const due = await listDueGvgEvents(sql);
  for (const event of due) {
    try {
      if (event.status === "running") await settleRunningGvg(sql, event);
      else await settleWindowClose(sql, event);
    } catch (err) {
      console.error(`settleGvg: GVG event ${event.id} failed to settle:`, err);
    }
  }
}

/**
 * Settle one 'scheduled'/'registration' event past its registration window:
 * release every submitted-but-unpicked team's lock (and every team of a
 * guild that never completed registration — 9.5's original release walk,
 * unchanged), then either auto-cancel it (fewer than 2 REGISTERED guilds) or
 * claim the flip to 'running' and fall through to settleRunningGvg()
 * immediately — the settlePastWindow precedent: a fresh event's very first
 * war can resolve in the very same settlement pass that started its bracket.
 */
async function settleWindowClose(sql, event) {
  const unpicked = await listUnreleasedUnpickedTeamsForEvent(sql, event.id);
  for (const team of unpicked) {
    const claimed = await claimReleaseGvgTeam(sql, team.id);
    if (!claimed) continue; // already released by an earlier pass
    await releaseGvgParty(sql, claimed.trainerId, claimed.monsterIds);
  }

  const registrations = await listGvgRegistrationsForEvent(sql, event.id);
  if (registrations.length < 2) {
    const claimedEvent = await claimCancelGvgEvent(sql, event.id);
    if (claimedEvent) await releaseAllCore(sql, claimedEvent);
    return;
  }

  // A lost claim just means someone else (another settlement pass, racing in
  // right now) already advanced this event — settleRunningGvg()'s own fresh
  // status re-read below is what actually decides whether to proceed, so
  // it's safe to fall through here either way.
  await claimStartGvgEvent(sql, event.id);
  await settleRunningGvg(sql, event);
}

/**
 * Settle one 'running' event: re-derive the guild bracket, resolve one round
 * of wars (+ the 3rd-place decider, if this round is the final) if
 * incomplete, then pay out and complete if the (possibly just-updated)
 * bracket is now fully resolved. Always re-reads the event's CURRENT status
 * first — the settleRunning precedent: a CONCURRENT admin cancel between
 * settleGvg()'s due-list read and this event's turn coming up must stop this
 * pass from resolving wars or paying rewards out from underneath it.
 */
async function settleRunningGvg(sql, event) {
  const fresh = await getGvgEventById(sql, event.id);
  if (!fresh || fresh.status !== "running") return; // cancelled (or otherwise moved on) since this pass started
  event = fresh;

  const registrations = await listGvgRegistrationsForEvent(sql, event.id);
  if (registrations.length < 2) return; // shouldn't happen once running; nothing sane to resolve
  const entrantIds = registrations.map((r) => String(r.guildId));

  let wars = await listWarsForEvent(sql, event.id);
  let { bracket, complete } = replayBracket(entrantIds, event.seed, toWarResultLog(wars));

  if (!complete) {
    const roundIdx = bracket.rounds.length - 1;
    const current = bracket.rounds[roundIdx];
    const isFinalRound = current.pairings.length === 1;

    for (let pos = 0; pos < current.pairings.length; pos++) {
      const p = current.pairings[pos];
      if (p.winner != null || p.a == null || p.b == null) continue; // bye (or already decided) — nothing to fight
      await settleWarPairing(sql, event, roundIdx, pos, p.a, p.b);
    }

    // The 3rd-place decider resolves in the SAME pass as the final, once
    // both its sides are real and it hasn't been played yet — the
    // settleRunning precedent (shared/rules/bracket.js's header convention:
    // its own seed sits at round = the final round's index, position 1).
    if (isFinalRound && bracket.thirdPlace && bracket.thirdPlace.a != null
        && bracket.thirdPlace.b != null && bracket.thirdPlace.winner == null) {
      await settleWarPairing(sql, event, roundIdx, 1, bracket.thirdPlace.a, bracket.thirdPlace.b);
    }

    wars = await listWarsForEvent(sql, event.id);
    ({ bracket, complete } = replayBracket(entrantIds, event.seed, toWarResultLog(wars)));
  }

  if (!complete) return;

  const ranks = placements(bracket); // [{entrantId, rank}] — entrantId is a stringified guild id
  const rewardsByRank = resolveRewards(ranks, event.rewards); // aligned 1:1 with `ranks`
  const standings = [];

  for (let i = 0; i < ranks.length; i++) {
    const { entrantId, rank } = ranks[i];
    const { rewards } = rewardsByRank[i];
    const guildId = Number(entrantId);
    standings.push({ rank, guildId });

    // Rewards follow CONTRIBUTION, not mere guild membership (the locked
    // design decision): every trainer whose team was actually IN this
    // guild's registered lineup is paid this rank's rewards in full, one
    // idempotent claim per team.
    const lineupTeams = await listLineupTeamsForGuildEvent(sql, event.id, guildId);
    for (const lineupTeam of lineupTeams) {
      const claimedTeam = await claimGvgTeamReward(sql, lineupTeam.id, { rank, rewards });
      if (!claimedTeam) continue; // already paid by an earlier (possibly crashed) settlement pass

      // NOTE: a crash between the reward claim above committing and these
      // two steps finishing would leave this team stamped-but-unpaid/
      // unreleased — the exact same accepted narrow window
      // server/services/tournament.js's settleRunning documents for its own
      // reward payout.
      for (const reward of rewards) {
        const granter = REWARD_GRANTERS[reward.type];
        if (granter) await granter(sql, claimedTeam.trainerId, reward);
      }
      // A no-op for an already-eliminated guild's teams (released the
      // instant their guild lost, in settleWarPairing below) — this is what
      // finally frees the champion/every other still-locked guild's teams.
      const releasedTeam = await claimReleaseGvgTeam(sql, lineupTeam.id);
      if (releasedTeam) await releaseGvgParty(sql, releasedTeam.trainerId, releasedTeam.monsterIds);
    }
  }

  standings.sort((a, b) => a.rank - b.rank);
  await claimCompleteGvgEvent(sql, event.id, standings);
}

/**
 * Play and persist exactly one war: load both guilds' PICKED lineups (lanes
 * only — the war relay itself doesn't need trainer names), seed off the
 * pairing's own coordinates, resolve via shared/rules/gvgWar.js's
 * resolveWarRelay(), and claim the insert exactly once (a lost claim is
 * fine — see insertGvgWar's own doc). THEN, only on a WON claim, release the
 * LOSING guild's every lineup team's lock immediately — the ROADMAP's locked
 * design decision: a knocked-out guild's monsters go home the instant it's
 * eliminated, not at the whole event's end.
 */
async function settleWarPairing(sql, event, round, position, aId, bId) {
  const guildA = Number(aId);
  const guildB = Number(bId);
  const seed = derivePairingSeed(event.seed, round, position);

  const lineupA = (await listLineupTeamsForGuildEvent(sql, event.id, guildA))
    .map((t) => ({ teamId: t.id, lanes: t.team.lanes }));
  const lineupB = (await listLineupTeamsForGuildEvent(sql, event.id, guildB))
    .map((t) => ({ teamId: t.id, lanes: t.team.lanes }));

  const war = resolveWarRelay(lineupA, lineupB, seed);
  const winnerGuildId = war.winner === "a" ? guildA : guildB;
  const loserGuildId = war.winner === "a" ? guildB : guildA;

  const inserted = await insertGvgWar(sql, {
    eventId: event.id, round, position, guildA, guildB, seed, winner: winnerGuildId,
    // The per-battle event log is never persisted (CLAUDE.md §1.6,
    // re-derivable forever from the stored seed + the frozen
    // gvg_teams.team snapshots) — only the small battles[] SUMMARY is,
    // alongside the tiebreak flag when the war's very last battle broke a
    // simultaneous-exhaustion draw with the extra seeded coin flip
    // (shared/rules/gvgWar.js's own header documents both shapes).
    results: { battles: war.battles, ...(war.tiebreak ? { tiebreak: true } : {}) },
  });
  if (inserted == null) return; // another settlement pass already computed and wrote the identical outcome

  const loserLineup = await listLineupTeamsForGuildEvent(sql, event.id, loserGuildId);
  for (const lineupTeam of loserLineup) {
    const released = await claimReleaseGvgTeam(sql, lineupTeam.id);
    if (!released) continue; // already released by an earlier pass
    await releaseGvgParty(sql, released.trainerId, released.monsterIds);
  }
}

/** `{round, position, winner}[]` for shared/rules/bracket.js's replayBracket,
 *  from listWarsForEvent()'s rows. */
function toWarResultLog(wars) {
  return wars.map((w) => ({ round: w.round, position: w.position, winner: w.winner === null ? null : String(w.winner) }));
}
