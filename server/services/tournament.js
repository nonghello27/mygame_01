// Tournament use-cases (Phase 9.2 — schema, admin lifecycle, registration).
// No battles resolve in this phase: bracket generation and round-by-round
// settlement are Phase 9.3 (settleTournaments()), which will live here
// alongside these functions. This phase only covers: admin create/cancel/
// list, and player list/register/withdraw.
//
// The client contributes exactly two choices across this whole domain:
// which tournament to register for/withdraw from, and which 3 monsters
// (register) — everything else (the entry-fee debit, the busy-lock claim,
// the frozen team snapshot) is decided/validated HERE against DB state,
// never trusted from the request body (CLAUDE.md §1.1).
//
// Registration follows the exact claim-first-then-pay + LIFO-compensation
// shape server/services/summon.js's performSummon set: (a) debit the entry
// fee, (b) claim the party's busy lock, (c) freeze the team snapshot, (d)
// insert the entry row — any failure from a given step onward undoes every
// earlier step, in reverse order, so a partial registration can never leave
// a trainer charged/locked with nothing to show for it.

import { httpError } from "../http.js";
import {
  insertTournament, listTournamentsWithCounts, getTournamentById, claimCancelTournament,
  listEntriesForTournament, listMyEntriesByTournament, insertEntry, claimWithdrawEntry,
  claimRefundEntry, claimPartyForTournament, releaseTournamentParty,
} from "../repos/tournaments.js";
import { listMonstersByTrainer } from "../repos/monsters.js";
import { listEquippedMonsterEquipment } from "../repos/equipment.js";
import { listSocketedRunes } from "../repos/runes.js";
import { debitGold, refundGold } from "../repos/trainers.js";
import { listSpeciesAdmin, listItemsAdmin, listEquipmentAdmin, listRunesAdmin } from "../repos/admin.js";
import { validateTournament } from "./adminValidate.js";
import { settleActivities } from "./activities.js";
import { toLane, groupByMonster } from "./matches.js";

export const PARTY_SIZE = 3;

// Registration is open purely by TIME WINDOW, not by status — a tournament
// is registerable the instant it's 'scheduled' (its only status in this
// phase; 'registration' is here so 9.3's eventual explicit flip doesn't
// change this list) AND `now()` falls inside [regStartsAt, regEndsAt].
const REGISTRABLE_STATUSES = ["scheduled", "registration"];

function withinWindow(tournament) {
  const now = Date.now();
  return now >= new Date(tournament.regStartsAt).getTime() && now <= new Date(tournament.regEndsAt).getTime();
}

/** {enteredAt, monsterIds, feePaid}, or null — NEVER a team snapshot: other
 *  trainers' rosters are never leaked through the tournament list. */
function toEntrySummary(entry) {
  if (!entry) return null;
  return { enteredAt: entry.enteredAt, monsterIds: entry.monsterIds, feePaid: entry.feePaid };
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

// --- player-facing: list / register / withdraw ------------------------------

/**
 * Every tournament (any status — cancelled/past stay visible as history),
 * newest first, with a live entrant count and the CALLER's own entry summary
 * only — another trainer's team snapshot is never included in this list
 * (CLAUDE.md §1.1: only what the caller is entitled to see).
 */
export async function listTournaments(sql, trainerId) {
  const [tournaments, myEntries] = await Promise.all([
    listTournamentsWithCounts(sql),
    listMyEntriesByTournament(sql, trainerId),
  ]);
  return {
    tournaments: tournaments.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      regStartsAt: t.regStartsAt,
      regEndsAt: t.regEndsAt,
      status: t.status,
      entryFee: t.entryFee,
      rewards: t.rewards,
      entrantCount: t.entrantCount,
      myEntry: toEntrySummary(myEntries.get(t.id)),
    })),
  };
}

/**
 * Register exactly 3 owned, free monsters for one tournament: pay the entry
 * fee (if any), claim the party's busy lock, freeze the team snapshot
 * (toLane()/groupByMonster — the EXACT adventure_sessions.party shape), and
 * insert the entry. Any failure compensates everything already won, in
 * reverse (LIFO) order: fee debited -> party claimed -> [snapshot+insert] —
 * so a throw after the party claim releases the party THEN refunds the fee,
 * and a throw after a partial party claim releases only what was claimed
 * before refunding.
 * @param {number[]} monsterIds the ONLY choice besides tournamentId itself
 */
export async function register(sql, trainerId, tournamentId, monsterIds) {
  const id = Number(tournamentId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "tournamentId must be a tournament's id");

  const tournament = await getTournamentById(sql, id);
  if (!tournament) throw httpError(404, "unknown tournament");
  if (!REGISTRABLE_STATUSES.includes(tournament.status) || !withinWindow(tournament)) {
    throw httpError(409, "registration is not open");
  }

  const ids = validatePartyIds(monsterIds);

  // Free anything that finished first (same precedent as createMatch /
  // adventure's start()), so a monster that has actually come home isn't
  // blocked by a stale busy_until.
  await settleActivities(sql, trainerId);

  // (a) entry-fee debit — claim-first-then-pay's first leg. A free
  // tournament (entryFee === 0) has nothing to pay or later refund.
  const feePaid = tournament.entryFee;
  if (feePaid > 0) {
    const debited = await debitGold(sql, trainerId, feePaid);
    if (!debited) throw httpError(409, "not enough gold for the entry fee");
  }

  // (b) the party busy-claim. A partial claim (fewer than PARTY_SIZE rows)
  // must release what it DID claim before refunding the fee — never leave a
  // monster locked with nothing to show for it.
  const claimed = await claimPartyForTournament(sql, trainerId, ids);
  if (claimed.length !== ids.length) {
    if (claimed.length > 0) await releaseTournamentParty(sql, trainerId, claimed);
    if (feePaid > 0) await refundGold(sql, trainerId, feePaid);
    throw httpError(409, "a monster is busy or not yours");
  }

  try {
    // (c) freeze the team snapshot: the trainer's own monsters, in the
    // chosen order, joined with equipped monster-domain gear and socketed
    // runes — same toLane() shape server/services/adventure.js's start()
    // freezes for its party.
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

    // (d) the entry insert. UNIQUE(tournament_id, trainer_id) is the
    // double-register guard — a race loses this as a 23505.
    const entry = await insertEntry(sql, {
      tournamentId: id, trainerId, team: { lanes, display }, monsterIds: ids, feePaid,
    });
    return { entry: toEntrySummary(entry) };
  } catch (err) {
    // Everything from (b) onward is undone here, in reverse: release the
    // party THEN refund the fee (LIFO — the party claim was the LATER win).
    await releaseTournamentParty(sql, trainerId, ids);
    if (feePaid > 0) await refundGold(sql, trainerId, feePaid);
    if (err.code === "23505") throw httpError(409, "already registered for this tournament");
    throw err;
  }
}

/**
 * Withdraw while registration is still open: the guarded entry DELETE is the
 * claim itself — it returning a row IS "you were registered and now are
 * not", atomically. A won claim releases the party lock and refunds
 * whatever this entry actually paid (fee_paid, frozen at registration time —
 * never a later entry_fee edit).
 *
 * A lost claim (null) is reported as the same 404 for two DIFFERENT reasons,
 * indistinguishable by design: "never registered / already withdrawn" OR — a
 * race with a CONCURRENT admin cancel — "already cancelled and refunded out
 * from under this request" (claimWithdrawEntry's `refunded = false` guard is
 * what makes that second case lose here instead of double-refunding the
 * fee). Either way the player ends up not-registered with nothing further
 * owed, so one 404 covers both correctly.
 */
export async function withdraw(sql, trainerId, tournamentId) {
  const id = Number(tournamentId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "tournamentId must be a tournament's id");

  const tournament = await getTournamentById(sql, id);
  if (!tournament) throw httpError(404, "unknown tournament");
  if (!REGISTRABLE_STATUSES.includes(tournament.status) || !withinWindow(tournament)) {
    throw httpError(409, "registration is closed");
  }

  const entry = await claimWithdrawEntry(sql, id, trainerId);
  if (!entry) throw httpError(404, "you are not registered for this tournament");

  await releaseTournamentParty(sql, trainerId, entry.monsterIds);
  if (entry.feePaid > 0) await refundGold(sql, trainerId, entry.feePaid);
  return { withdrawn: true };
}

// --- admin: create / cancel / list ------------------------------------------

/**
 * Validate + mint a new tournament. Status ALWAYS starts 'scheduled' — this
 * phase never advances it (registration is gated purely by the time window,
 * not status; the scheduled -> registration -> running -> completed walk is
 * 9.3's settleTournaments()). The seed is minted here (same
 * Math.random()-then-store precedent as match creation / Summon Hall pulls)
 * so the eventual bracket (9.3) is replayable from this row alone, even
 * though nothing reads it until then.
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
  const t = validateTournament(input, lookups);
  const seed = Math.floor(Math.random() * 0x7fffffff);
  return insertTournament(sql, { ...t, seed });
}

/**
 * Cancel at ANY non-completed status: releases every entrant's locks and
 * refunds every entry's fee, paying nothing else, and keeps the row visible
 * in history (status flips to 'cancelled', the row is never deleted).
 *
 * Idempotency / safe re-run: the status flip and the refund/release loop are
 * deliberately two separate steps. The flip only runs once (a tournament
 * already 'cancelled' skips straight to the loop rather than re-claiming a
 * status it already has — re-claiming would 409 and abort BEFORE finishing
 * any entries a crashed earlier attempt left unrefunded, which would defeat
 * the whole point of the idempotent per-entry claim below). The loop itself
 * is what's actually safe to re-run any number of times: claimRefundEntry
 * only returns a row (and only THEN do we credit gold / release a lock) for
 * an entry that hasn't been refunded yet, so re-invoking this on an
 * already-cancelled tournament (an operator clicking Cancel twice, or a
 * retried request after a mid-loop crash) only ever finishes the remainder —
 * never double-pays, never double-releases. 'completed' is the one true
 * dead end: once 9.3 pays rewards there is nothing left to refund and
 * un-paying a reward is out of scope, so it 409s outright.
 */
export async function adminCancel(sql, tournamentId) {
  const id = Number(tournamentId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "tournamentId must be a tournament's id");

  const before = await getTournamentById(sql, id);
  if (!before) throw httpError(404, "unknown tournament");
  if (before.status === "completed") throw httpError(409, "cannot cancel a completed tournament");

  let tournament = before;
  if (before.status !== "cancelled") {
    const claimed = await claimCancelTournament(sql, id);
    // A lost claim here means a concurrent request already moved it to a
    // terminal status between our read and this UPDATE — re-read to give an
    // accurate message rather than assuming which one.
    if (!claimed) {
      const now = await getTournamentById(sql, id);
      throw httpError(409, `tournament is already ${now?.status ?? "resolved"}`);
    }
    tournament = claimed;
  }

  const entries = await listEntriesForTournament(sql, id);
  for (const entry of entries) {
    const claimedEntry = await claimRefundEntry(sql, entry.id);
    if (!claimedEntry) continue; // already refunded by an earlier cancel attempt
    if (claimedEntry.feePaid > 0) await refundGold(sql, claimedEntry.trainerId, claimedEntry.feePaid);
    await releaseTournamentParty(sql, claimedEntry.trainerId, claimedEntry.monsterIds);
  }

  return tournament;
}

/** All tournaments + entrant counts, for the admin tab (same read as the
 *  player list, minus the per-caller entry summary — an admin sees every
 *  tournament's aggregate, never needs a "my entry" of their own here). */
export async function adminList(sql) {
  return { tournaments: await listTournamentsWithCounts(sql) };
}
