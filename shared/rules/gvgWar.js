// Pure, seeded guild-vs-guild WAR RELAY math (Phase 9.7). No DB, no I/O, no
// Math.random — same determinism contract as shared/rules/bracket.js (same
// warSeed + same lineups ALWAYS reproduce an identical result, battle by
// battle): the caller (server/services/gvg.js) mints one war's seed off
// derivePairingSeed(event.seed, round, position) exactly like a tournament
// pairing, and everything below is then re-derivable/auditable forever from
// that one stored seed plus the two guilds' frozen lineup snapshots.
//
// A war is a RELAY, not a single battle: guild A's CURRENT team fights guild
// B's CURRENT team; side a is ALWAYS guild A and side b is ALWAYS guild B,
// every battle in the chain (never swapped, so a lineup's own team order is
// always read front-to-back the same way tournament rounds read entrant
// order). Locked design rules (docs/ROADMAP.md's Phase 9.7):
//
//   - Each battle's seed derives from the war seed + that battle's 0-based
//     index via shared/rules/adventure.js's deriveNodeSeed(warSeed, index) —
//     the same "XOR with a position-dependent constant" precedent
//     derivePairingSeed/deriveTierSeed already set, reused rather than
//     copied (CLAUDE.md §1.4).
//   - A DECISIVE battle: the LOSING side's next team (by lineup order) steps
//     in FRESH (no startHp/startStatuses — full health, clean statuses,
//     exactly as it was frozen at submission); the WINNING side's current
//     team carries its EXACT finalState (Phase 9.6) forward into the next
//     battle — for each of its lanes, `startHp`/`startStatuses` are set from
//     the finalState entry with the matching `idx`, spread onto a COPY of
//     the frozen lane (the caller's lineup objects are never mutated: a
//     fresh JS object per lane, a fresh array per team).
//   - A DRAWN battle (the engine's own TURN_CAP hard stop) eliminates BOTH
//     current teams — neither carries anything forward; both sides' next
//     team (if any) steps in fresh.
//   - The war ends the instant a side has no next team to field: the OTHER
//     side wins outright. If both sides exhaust AT THE SAME TIME (a draw
//     when both current teams were each side's LAST team), the tie breaks
//     with one more deterministic roll off the war seed itself —
//     `makeRng(warSeed).chance(50)` (true = 'a' wins) — the exact
//     coin-flip-off-the-same-seed precedent server/services/tournament.js's
//     settlePairing() uses for a drawn bracket pairing — and the result
//     records `tiebreak: true` so this rare path stays visibly auditable.
//
// battles[] is a SMALL per-battle SUMMARY, never the event log (CLAUDE.md
// §1.6 — a war is re-derivable forever from its stored seed + the two
// guilds' frozen gvg_teams.team snapshots, exactly like a tournament match
// never persists its own event log): `{index, teamA, teamB, seed, outcome,
// aAlive, bAlive}` — `teamA`/`teamB` are the gvg_teams row ids that fought
// (the caller's own `teamId` tag on each lineup entry), `outcome` is
// `'a'|'b'|'draw'`, and `aAlive`/`bAlive` count units with hp > 0 in that
// battle's own finalState — a cheap "how bruised did the winner come out"
// signal without shipping the full event log.

import { resolveBattle } from "../engine/resolve.js";
import { makeRng } from "../engine/rng.js";
import { deriveNodeSeed } from "./adventure.js";

/**
 * One lineup entry's lanes, untouched — used the instant a team steps in
 * for the FIRST time (it was frozen fresh at submission, nothing to carry).
 */
function freshLanes(entry) {
  return entry.lanes;
}

/**
 * One lineup entry's lanes with this battle's finalState folded back in, by
 * idx — used when this team WON and continues into the next battle. Never
 * mutates `entry` or any lane inside it: a brand new array of brand new lane
 * objects comes back every time.
 */
function carryLanes(entry, finalStateSide) {
  const byIdx = new Map(finalStateSide.map((s) => [s.idx, s]));
  return entry.lanes.map((l) => {
    const carry = byIdx.get(l.idx);
    return carry ? { ...l, startHp: carry.hp, startStatuses: carry.statuses } : { ...l };
  });
}

function countAlive(finalStateSide) {
  return finalStateSide.filter((s) => s.hp > 0).length;
}

/**
 * Resolve one whole guild-vs-guild war: a chain of resolveBattle() calls
 * over two ordered lineups, per the header's carry-over/elimination rules.
 * @param {{teamId:number|string, lanes:object[]}[]} lineupA guild A's teams,
 *   in battle order (their own `battle_order`) — non-empty
 * @param {{teamId:number|string, lanes:object[]}[]} lineupB guild B's teams,
 *   same shape — non-empty
 * @param {number} warSeed this war's own 32-bit seed (derivePairingSeed's
 *   output, same as a tournament pairing)
 * @returns {{winner:'a'|'b', tiebreak:boolean, battles:object[]}}
 */
export function resolveWarRelay(lineupA, lineupB, warSeed) {
  if (!Array.isArray(lineupA) || lineupA.length === 0) {
    throw new Error("resolveWarRelay: lineupA must be a non-empty array");
  }
  if (!Array.isArray(lineupB) || lineupB.length === 0) {
    throw new Error("resolveWarRelay: lineupB must be a non-empty array");
  }

  let ai = 0;
  let bi = 0;
  let lanesA = freshLanes(lineupA[ai]);
  let lanesB = freshLanes(lineupB[bi]);
  const battles = [];

  for (let index = 0; ; index++) {
    const seed = deriveNodeSeed(warSeed, index);
    const result = resolveBattle(lanesA, lanesB, seed);
    const outcome = result.draw ? "draw" : result.youWin ? "a" : "b";
    battles.push({
      index,
      teamA: lineupA[ai].teamId,
      teamB: lineupB[bi].teamId,
      seed,
      outcome,
      aAlive: countAlive(result.finalState.a),
      bAlive: countAlive(result.finalState.b),
    });

    if (outcome === "draw") {
      const aHasNext = ai + 1 < lineupA.length;
      const bHasNext = bi + 1 < lineupB.length;
      if (!aHasNext && !bHasNext) {
        const tiebreakWinner = makeRng(warSeed).chance(50) ? "a" : "b";
        return { winner: tiebreakWinner, tiebreak: true, battles };
      }
      if (!aHasNext) return { winner: "b", tiebreak: false, battles };
      if (!bHasNext) return { winner: "a", tiebreak: false, battles };
      ai++;
      bi++;
      lanesA = freshLanes(lineupA[ai]);
      lanesB = freshLanes(lineupB[bi]);
    } else if (outcome === "a") {
      if (bi + 1 >= lineupB.length) return { winner: "a", tiebreak: false, battles };
      lanesA = carryLanes(lineupA[ai], result.finalState.a);
      bi++;
      lanesB = freshLanes(lineupB[bi]);
    } else {
      if (ai + 1 >= lineupA.length) return { winner: "b", tiebreak: false, battles };
      lanesB = carryLanes(lineupB[bi], result.finalState.b);
      ai++;
      lanesA = freshLanes(lineupA[ai]);
    }
  }
}
