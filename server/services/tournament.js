// Tournament use-cases (Phase 9.2 schema/lifecycle/registration + Phase 9.3
// lazy resolution/rewards/results).
//
// The client contributes exactly two choices across this whole domain:
// which tournament to register for/withdraw from, and which 3 monsters
// (register) — everything else (the entry-fee debit, the busy-lock claim,
// the frozen team snapshot, the ENTIRE bracket, every battle, every reward)
// is decided/validated/rolled HERE against DB state, never trusted from the
// request body (CLAUDE.md §1.1).
//
// Registration follows the exact claim-first-then-pay + LIFO-compensation
// shape server/services/summon.js's performSummon set: (a) debit the entry
// fee, (b) claim the party's busy lock, (c) freeze the team snapshot, (d)
// insert the entry row — any failure from a given step onward undoes every
// earlier step, in reverse order, so a partial registration can never leave
// a trainer charged/locked with nothing to show for it.
//
// --- settlement (Phase 9.3) --------------------------------------------------
//
// settleTournaments(sql) is the lazy-time hook (CLAUDE.md §1.5 — no cron,
// ever): called at the top of every read (listTournaments/adminList/
// getTournamentDetail), it brings every due tournament's state fully up to
// date before anything else runs, same "lazy settle on read" precedent as
// settleActivities/ensureSeason.
//
//   scheduled/registration, past reg_ends_at:
//     fewer than 2 entries -> auto-cancel (the exact admin-cancel refund/
//       release path, via the shared cancelCore() below) and done.
//     otherwise -> claimStartTournament (guarded scheduled/registration ->
//       running; a lost claim just means someone else already advanced it —
//       re-read and keep going only if it's now 'running').
//
//   running (having just started, above, or already there):
//     re-derive the bracket PURELY from (entry ids ordered by id ASC,
//     tournaments.seed, tournament_matches rows) via shared/rules/
//     bracket.js's replayBracket() — CLAUDE.md §1.6, there is no bracket
//     JSONB column anywhere; tournament_matches is the sole durable record.
//     If incomplete: resolve exactly ONE round this pass (bounded work per
//     serverless invocation — a big bracket resolves over several reads, not
//     one giant one): every real pairing in the bracket's current last round
//     that has no winner yet gets a battle, seeded by derivePairingSeed(seed,
//     round, position) off the pairing's own coordinates — resolveBattle()
//     called DIRECTLY (the adventure.js precedent: no matches row, since a
//     tournament pairing has its own tournament_matches row instead) — and
//     persisted via the exactly-once insertTournamentMatch() claim (a lost
//     claim just means another settlement pass got there first; since the
//     outcome is fully deterministic from the stored seed, the loser would
//     have computed the identical winner anyway, so it simply skips writing
//     it again). A draw breaks by a FRESH seeded coin flip off that SAME
//     pairing seed (makeRng(seed).chance(50)) — still deterministic and
//     replayable, just one more roll off the same stream. When the round
//     just resolved is the FINAL and the bracket's thirdPlace decider has
//     both real sides but no winner yet, it's ALSO resolved in this same
//     pass (its own seed at round = the final round's index, position 1 —
//     the header convention shared/rules/bracket.js documents).
//     After resolving, the bracket is re-derived once more; if now complete,
//     every entrant is paid: shared/rules/bracket.js's placements() ->
//     shared/rules/rewards.js's resolveRewards() against this tournament's
//     configured rewards, one idempotent claimEntryReward() per entry
//     (reward IS NULL is the gate — a re-run after a crash mid-payout only
//     ever finishes the remainder, never double-pays or double-releases),
//     granting through the pluggable REWARD_GRANTERS registry (Phase 9.7
//     lifted this out to server/services/eventRewards.js the moment GVG
//     needed the identical registry — one source of truth, no drift) and
//     releasing that entry's party lock, THEN — only once every entry is
//     stamped — claimCompleteTournament flips running -> completed with the
//     standings JSONB. Admin cancel mid-'running' still works exactly as
//     9.2 designed it: claimCancelTournament's WHERE only excludes
//     completed/cancelled, so a concurrent cancel simply wins the race for
//     the status column and this settlement pass's own re-read sees
//     'cancelled' and stops.

import { httpError } from "../http.js";
import {
  insertTournament, listTournamentsWithCounts, getTournamentById, claimCancelTournament,
  listEntriesForTournament, listMyEntriesByTournament, getEntry, insertEntry, claimWithdrawEntry,
  claimRefundEntry, claimPartyForTournament, releaseTournamentParty,
  openRegistrationWindows, listDueTournaments, claimStartTournament, claimCompleteTournament,
  insertTournamentMatch, listMatchesForTournament, claimEntryReward, listEntrantsForTournament,
} from "../repos/tournaments.js";
import { listMonstersByTrainer } from "../repos/monsters.js";
import { listEquippedMonsterEquipment } from "../repos/equipment.js";
import { listSocketedRunes } from "../repos/runes.js";
import { debitGold, refundGold } from "../repos/trainers.js";
import {
  listSpeciesAdmin, listItemsAdmin, listEquipmentAdmin, listRunesAdmin,
} from "../repos/admin.js";
import { validateTournament } from "./adminValidate.js";
import { settleActivities } from "./activities.js";
import { toLane, groupByMonster } from "./matches.js";
import { REWARD_GRANTERS } from "./eventRewards.js";
import { resolveBattle } from "../../shared/engine/resolve.js";
import { makeRng } from "../../shared/engine/rng.js";
import { replayBracket, derivePairingSeed, placements } from "../../shared/rules/bracket.js";
import { resolveRewards } from "../../shared/rules/rewards.js";

export const PARTY_SIZE = 3;

// Registration is open purely by TIME WINDOW, not by status — a tournament
// is registerable the instant it's 'scheduled' (or 'registration', once
// settleTournaments() has cosmetically flipped it there) AND `now()` falls
// inside [regStartsAt, regEndsAt].
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
  await settleTournaments(sql);
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
    // double-register guard — a race loses this INSERT as a 23505.
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

// --- tournament detail: bracket + standings (Phase 9.3) ---------------------

/**
 * Everything the detail view needs and NOTHING more (CLAUDE.md §1.1 — never
 * another trainer's lanes): the tournament summary, every entrant's public
 * display info (+ their stamped reward, once paid), the bracket re-derived
 * round by round with each pairing's seed, the 3rd-place pairing (same
 * shape), the enriched standings, and the caller's own entry summary. Each
 * pairing carries its stored seed so a past match stays independently
 * replayable server-side from the seed + the frozen tournament_entries.team
 * snapshots; the lanes themselves are never shipped in this response (only
 * display data) — a client-facing replay feature would need its own
 * per-match read, out of scope for 9.3. Settlement runs first (the lazy
 * hook), so this always reflects the freshest possible state.
 */
export async function getTournamentDetail(sql, trainerId, tournamentId) {
  await settleTournaments(sql);

  const id = Number(tournamentId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "tournamentId must be a tournament's id");
  const t = await getTournamentById(sql, id);
  if (!t) throw httpError(404, "unknown tournament");

  const [entries, entrants, myEntryRow] = await Promise.all([
    listEntriesForTournament(sql, id),
    listEntrantsForTournament(sql, id),
    getEntry(sql, id, trainerId),
  ]);

  let rounds = null;
  let thirdPlace = null;
  // Only attempt a replay once a bracket could plausibly exist: at least 2
  // entrants, AND either the tournament has actually started running at some
  // point (there's a tournament_matches row) or it's running/completed right
  // now. A tournament cancelled BEFORE ever reaching 'running' has neither —
  // its rounds correctly stay null (no bracket was ever generated for it).
  if (entries.length >= 2) {
    const matches = await listMatchesForTournament(sql, id);
    if (matches.length > 0 || t.status === "running" || t.status === "completed") {
      const entrantIds = entries.map((e) => String(e.id));
      const priorResults = matches.map((m) => ({
        round: m.round, position: m.position, winner: m.winner === null ? null : String(m.winner),
      }));
      const { bracket } = replayBracket(entrantIds, t.seed, priorResults);
      const matchBySpot = new Map(matches.map((m) => [`${m.round}:${m.position}`, m]));

      rounds = bracket.rounds.map((round, roundIdx) => ({
        pairings: round.pairings.map((p, pos) => {
          const m = matchBySpot.get(`${roundIdx}:${pos}`);
          return {
            a: p.a == null ? null : Number(p.a),
            b: p.b == null ? null : Number(p.b),
            winner: p.winner == null ? null : Number(p.winner),
            seed: m ? m.seed : null,
          };
        }),
      }));

      if (bracket.thirdPlace) {
        const finalRoundIdx = bracket.rounds.length - 1;
        const m = matchBySpot.get(`${finalRoundIdx}:1`);
        thirdPlace = {
          a: bracket.thirdPlace.a == null ? null : Number(bracket.thirdPlace.a),
          b: bracket.thirdPlace.b == null ? null : Number(bracket.thirdPlace.b),
          winner: bracket.thirdPlace.winner == null ? null : Number(bracket.thirdPlace.winner),
          seed: m ? m.seed : null,
        };
      }
    }
  }

  const entrantById = new Map(entrants.map((e) => [e.entryId, e]));
  const standings = (t.standings ?? []).map((s) => ({
    rank: s.rank,
    entryId: s.entryId,
    trainerId: s.trainerId,
    trainerName: entrantById.get(s.entryId)?.trainerName ?? null,
    reward: entrantById.get(s.entryId)?.reward ?? null,
  }));

  return {
    tournament: {
      id: t.id,
      name: t.name,
      description: t.description,
      regStartsAt: t.regStartsAt,
      regEndsAt: t.regEndsAt,
      status: t.status,
      entryFee: t.entryFee,
      rewards: t.rewards,
      entrantCount: entries.length,
    },
    entrants: entrants.map((e) => ({
      entryId: e.entryId, trainerId: e.trainerId, trainerName: e.trainerName, display: e.display,
    })),
    rounds,
    thirdPlace,
    standings,
    myEntry: toEntrySummary(myEntryRow),
  };
}

// --- admin: create / cancel / list ------------------------------------------

/**
 * Validate + mint a new tournament. Status ALWAYS starts 'scheduled' — the
 * scheduled -> registration -> running -> completed walk is entirely
 * settleTournaments()'s job on later reads. The seed is minted here (same
 * Math.random()-then-store precedent as match creation / Summon Hall pulls)
 * so the eventual bracket is replayable from this row alone.
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
 * The refund/release loop shared by BOTH the admin's explicit cancel AND
 * settlement's auto-cancel (fewer than 2 entrants at reg_ends_at) — the
 * CALLER is responsible for having already flipped `tournament.status` to
 * 'cancelled' (or already found it there); this only walks entries.
 *
 * Idempotency / safe re-run: claimRefundEntry only returns a row (and only
 * THEN do we credit gold / release a lock) for an entry that hasn't been
 * refunded yet, so re-invoking this on an already-cancelled tournament (an
 * operator clicking Cancel twice, a retried request after a mid-loop crash,
 * or settlement re-visiting a tournament it auto-cancelled last pass) only
 * ever finishes the remainder — never double-pays, never double-releases.
 */
async function cancelCore(sql, tournament) {
  const entries = await listEntriesForTournament(sql, tournament.id);
  for (const entry of entries) {
    const claimedEntry = await claimRefundEntry(sql, entry.id);
    if (!claimedEntry) continue; // already refunded by an earlier cancel attempt
    if (claimedEntry.feePaid > 0) await refundGold(sql, claimedEntry.trainerId, claimedEntry.feePaid);
    await releaseTournamentParty(sql, claimedEntry.trainerId, claimedEntry.monsterIds);
  }
  return tournament;
}

/**
 * Cancel at ANY non-completed status: releases every entrant's locks and
 * refunds every entry's fee, paying nothing else, and keeps the row visible
 * in history (status flips to 'cancelled', the row is never deleted).
 *
 * The status flip and the refund/release loop (cancelCore, above) are
 * deliberately two separate steps. The flip only runs once (a tournament
 * already 'cancelled' skips straight to cancelCore rather than re-claiming a
 * status it already has — re-claiming would 409 and abort BEFORE finishing
 * any entries a crashed earlier attempt left unrefunded, which would defeat
 * the whole point of cancelCore's idempotent per-entry claim). 'completed'
 * is the one true dead end: once settlement pays rewards there is nothing
 * left to refund and un-paying a reward is out of scope, so it 409s outright.
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

  return cancelCore(sql, tournament);
}

/** All tournaments + entrant counts, for the admin tab (same read as the
 *  player list, minus the per-caller entry summary — an admin sees every
 *  tournament's aggregate, never needs a "my entry" of their own here). */
export async function adminList(sql) {
  await settleTournaments(sql);
  return { tournaments: await listTournamentsWithCounts(sql) };
}

// --- settlement engine (Phase 9.3) ------------------------------------------

/** `{round, position, winner}[]` for shared/rules/bracket.js's replayBracket,
 *  from listMatchesForTournament()'s rows. */
function toResultLog(matches) {
  return matches.map((m) => ({ round: m.round, position: m.position, winner: m.winner === null ? null : String(m.winner) }));
}

/**
 * Settle one 'scheduled'/'registration' tournament past its registration
 * window: auto-cancel it if it never got 2 entrants, otherwise claim the
 * flip to 'running' and fall through to settleRunning() immediately — a
 * fresh tournament's very first battle can resolve in the very same
 * settlement pass that started its bracket.
 */
async function settlePastWindow(sql, tournament) {
  const entries = await listEntriesForTournament(sql, tournament.id);
  if (entries.length < 2) {
    const claimed = await claimCancelTournament(sql, tournament.id);
    if (claimed) await cancelCore(sql, claimed);
    return;
  }

  // A lost claim just means someone else (another settlement pass, racing in
  // right now) already advanced this tournament — settleRunning()'s own
  // fresh status re-read below is what actually decides whether to proceed,
  // so it's safe to fall through here either way.
  await claimStartTournament(sql, tournament.id);
  await settleRunning(sql, tournament, entries);
}

/**
 * Settle one 'running' tournament: re-derive the bracket, resolve one round
 * (+ the 3rd-place decider, if this round is the final) if incomplete, then
 * pay out and complete if the (possibly just-updated) bracket is now fully
 * resolved.
 *
 * Always re-reads the tournament's CURRENT status first, even when the
 * caller already believes it's 'running' — settleTournaments()'s own due
 * list is read once at the top of a whole settlement pass, so by the time
 * this specific tournament's turn comes up a CONCURRENT admin cancel could
 * have already flipped it; without this re-check, a cancelled tournament
 * could still have battles resolved and rewards paid out from underneath
 * the cancel that already refunded/released everything.
 * @param {object[]} [entries] already-read entries, ordered by id ASC (an
 *   optional param so settlePastWindow can hand off its own read rather than
 *   re-querying moments later)
 */
async function settleRunning(sql, tournament, entries) {
  const fresh = await getTournamentById(sql, tournament.id);
  if (!fresh || fresh.status !== "running") return; // cancelled (or otherwise moved on) since this pass started
  tournament = fresh;

  const rows = entries ?? (await listEntriesForTournament(sql, tournament.id));
  if (rows.length < 2) return; // shouldn't happen once running; nothing sane to resolve
  const entryById = new Map(rows.map((e) => [String(e.id), e]));
  const entrantIds = rows.map((e) => String(e.id));

  let matches = await listMatchesForTournament(sql, tournament.id);
  let { bracket, complete } = replayBracket(entrantIds, tournament.seed, toResultLog(matches));

  if (!complete) {
    const roundIdx = bracket.rounds.length - 1;
    const current = bracket.rounds[roundIdx];
    const isFinalRound = current.pairings.length === 1;

    for (let pos = 0; pos < current.pairings.length; pos++) {
      const p = current.pairings[pos];
      if (p.winner != null || p.a == null || p.b == null) continue; // bye (or already decided) — nothing to play
      await settlePairing(sql, tournament, entryById, roundIdx, pos, p.a, p.b);
    }

    // The 3rd-place decider resolves in the SAME pass as the final, once
    // both its sides are real and it hasn't been played yet (its sides only
    // become known the moment the semifinal round — one pass earlier —
    // completes, so by the time this round IS the final, thirdPlace is
    // already populated on `bracket` here).
    if (isFinalRound && bracket.thirdPlace && bracket.thirdPlace.a != null
        && bracket.thirdPlace.b != null && bracket.thirdPlace.winner == null) {
      await settlePairing(sql, tournament, entryById, roundIdx, 1, bracket.thirdPlace.a, bracket.thirdPlace.b);
    }

    matches = await listMatchesForTournament(sql, tournament.id);
    ({ bracket, complete } = replayBracket(entrantIds, tournament.seed, toResultLog(matches)));
  }

  if (!complete) return;

  const ranks = placements(bracket); // [{entrantId, rank}] — entrantId is a stringified entry id
  const rewardsByRank = resolveRewards(ranks, tournament.rewards); // aligned 1:1 with `ranks`
  const standings = [];

  for (let i = 0; i < ranks.length; i++) {
    const { entrantId, rank } = ranks[i];
    const { rewards } = rewardsByRank[i];
    const entry = entryById.get(entrantId);
    standings.push({ rank, entryId: Number(entrantId), trainerId: entry.trainerId });

    const claimedEntry = await claimEntryReward(sql, entry.id, { rank, rewards });
    if (!claimedEntry) continue; // already paid by an earlier (possibly crashed) settlement pass

    // NOTE: a crash between the reward claim above committing and these two
    // steps finishing would leave this entry stamped-but-unpaid/unreleased —
    // the exact same accepted narrow window server/services/matches.js's
    // resolveMatch documents for PVP Elo/rune durability after its own
    // resolve claim. Nothing else here re-checks `claimedEntry.reward`
    // against DB state afterward, by the same reasoning.
    for (const reward of rewards) {
      const granter = REWARD_GRANTERS[reward.type];
      if (granter) await granter(sql, entry.trainerId, reward);
    }
    await releaseTournamentParty(sql, entry.trainerId, entry.monsterIds);
  }

  standings.sort((a, b) => a.rank - b.rank);
  await claimCompleteTournament(sql, tournament.id, standings);
}

/**
 * Play and persist exactly one pairing: seed off its own coordinates,
 * resolve directly (no matches row — same "an event fight needs no opposing
 * trainer row" reasoning as adventure.js's battle node), break a draw with
 * one more roll off the SAME seeded stream, and claim the insert exactly
 * once (a lost claim is fine — see insertTournamentMatch's own doc).
 */
async function settlePairing(sql, tournament, entryById, round, position, aId, bId) {
  const entryA = entryById.get(aId);
  const entryB = entryById.get(bId);
  const seed = derivePairingSeed(tournament.seed, round, position);
  const battle = resolveBattle(entryA.team.lanes, entryB.team.lanes, seed);

  let winnerEntryId;
  if (battle.draw) {
    winnerEntryId = makeRng(seed).chance(50) ? entryA.id : entryB.id;
  } else {
    winnerEntryId = battle.youWin ? entryA.id : entryB.id;
  }

  await insertTournamentMatch(sql, {
    tournamentId: tournament.id, round, position,
    entryA: entryA.id, entryB: entryB.id, seed, winner: winnerEntryId,
    // The event log is never persisted (CLAUDE.md §1.6, re-derivable forever
    // from the stored seed + the frozen team snapshots already sitting in
    // tournament_entries.team) — only the plain outcome is.
    result: { youWin: battle.youWin, draw: battle.draw, survivor: battle.survivor },
  });
}

/**
 * The lazy-time entry point (CLAUDE.md §1.5): called at the top of every
 * tournament read. Cosmetically opens any window that's actually started,
 * then brings every due tournament fully up to date, one at a time. A single
 * tournament's settlement failing (an unregistered reward type, a transient
 * DB hiccup) is logged and skipped rather than allowed to break every OTHER
 * tournament's read — the next read's pass simply tries it again.
 */
export async function settleTournaments(sql) {
  await openRegistrationWindows(sql);
  const due = await listDueTournaments(sql);
  for (const t of due) {
    try {
      if (t.status === "running") await settleRunning(sql, t);
      else await settlePastWindow(sql, t);
    } catch (err) {
      console.error(`settleTournaments: tournament ${t.id} failed to settle:`, err);
    }
  }
}
