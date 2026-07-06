// Event reward grammar + resolution (Phase 9.1) — the ONE reward shape and
// ONE payout math tournaments AND GVG share (docs/ROADMAP.md's Phase 9
// cross-cutting rules: "one reward grammar, one payout path"). Pure — no
// DB, no I/O, no RNG (there's no randomness left to resolve here: the
// bracket's own seeded tie-break, shared/rules/bracket.js's placements(),
// already made every rank draw deterministic and replayable; this module
// just maps ranks to rewards). GRANTING a reward — crediting gold, minting
// an item/equipment/rune/monster — is the CALLER's job (server/services/
// tournaments.js, a follow-up phase, through a pluggable registry, the same
// REQUIREMENT_CHECKERS precedent server/services/summon.js set); this file
// only computes WHAT is owed to WHOM.
//
// --- reward grammar ---------------------------------------------------------
//
// A single reward is one of:
//   {type:'gold', amount}
//   {type:'item', itemId, qty}
//   {type:'equipment', equipmentDefId}
//   {type:'rune', runeDefId}
//   {type:'monster', speciesId}
//
// EVENT_REWARD_TYPES is the closed list above — server/services/
// adminValidate.js's validateEventRewards() rejects any other `type`, and a
// later reward kind is one more entry here AND one more branch in that
// validator AND one more server/services/<event>.js grant-registry entry —
// never a bare `if` bolted onto an existing branch (CLAUDE.md §1.4).
//
// --- rewards config ----------------------------------------------------------
//
//   {
//     positionRewards: { 1: Reward[], 2: Reward[], 3: Reward[] }, // any key
//       // may be absent — an absent position pays nothing extra for that
//       // rank (its owner still only gets what's listed, never a
//       // percentile top-up: see resolveRewards below)
//     percentileRewards: [
//       { fromPct, toPct, rewards: Reward[] }, ...
//     ]
//   }
//
// percentileRewards tiers MUST be ordered, contiguous, non-overlapping,
// and cover 1–100 EXACTLY: the first tier's fromPct is 1, each next tier's
// fromPct is the previous tier's toPct + 1, and the last tier's toPct is
// 100. validatePercentileCoverage() below is the ONE place that math lives
// — adminValidate.validateEventRewards() calls it instead of re-deriving
// the coverage rule, so there is exactly one source of truth for "do these
// tiers cover the whole field" (CLAUDE.md §1.3/1.4).
//
// --- resolution --------------------------------------------------------------
//
// resolveRewards(placements, config) takes shared/rules/bracket.js's
// placements() output — `{entrantId, rank}[]`, one entry per real entrant,
// ranks 1..N with no gaps — and returns a flat
// `[{trainerId, rewards}]` (the placements' `entrantId` IS a trainer id at
// this layer — a tournament/GVG entrant is a trainer, echoed back under the
// `trainerId` key rather than `entrantId` only because that's what the
// caller's payout code reads off it; no other transformation happens).
//
// Rule: ranks 1, 2, and 3 receive EXACTLY `positionRewards[rank]` (an
// absent key there is an empty rewards list, never falls through to a
// percentile tier). Every other rank's percentile is
//
//     pct = Math.ceil(rank * 100 / totalEntrants)
//
// — e.g. rank 4 of a 4-entrant field is pct 100 (last place, bottom tier);
// rank 4 of a 100-entrant field is pct 4 (near the top of "everyone else").
// This ceiling formula guarantees every rank beyond the podium lands in
// EXACTLY one tier: since tiers are validated to cover 1–100 with no gaps
// or overlaps, and pct is always an integer in [1,100] for any rank in
// [1,totalEntrants], the tier lookup below can never come up empty for a
// config that passed validatePercentileCoverage().

/** The closed set of reward types every event reward grammar accepts. */
export const EVENT_REWARD_TYPES = ["gold", "item", "equipment", "rune", "monster"];

/**
 * Validate that a percentile tier list is ordered, integer-bounded within
 * 1–100, contiguous, and covers 1–100 exactly with no gap or overlap. Pure
 * (throws a plain Error, not an httpError — this module has no dependency
 * on the server layer) so BOTH the admin validator (server/services/
 * adminValidate.js, which wraps this in httpError(400, ...)) and any future
 * caller (a client-side preview, a test) share the identical rule.
 * @param {{fromPct:number, toPct:number}[]} tiers
 * @returns {typeof tiers} the same array, for chaining
 */
export function validatePercentileCoverage(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new Error("percentileRewards must be a non-empty array");
  }
  let expectedFrom = 1;
  tiers.forEach((tier, i) => {
    const label = `percentileRewards[${i}]`;
    if (!Number.isInteger(tier?.fromPct) || !Number.isInteger(tier?.toPct)) {
      throw new Error(`${label}: fromPct/toPct must be integers`);
    }
    if (tier.fromPct < 1 || tier.toPct > 100 || tier.fromPct > tier.toPct) {
      throw new Error(`${label}: fromPct/toPct must be within 1-100 with fromPct <= toPct`);
    }
    if (tier.fromPct !== expectedFrom) {
      throw new Error(
        `${label}: fromPct must be ${expectedFrom} — tiers must be contiguous, starting at 1, with no gap or overlap`
      );
    }
    expectedFrom = tier.toPct + 1;
  });
  if (expectedFrom !== 101) {
    throw new Error(`percentileRewards must cover up to pct 100 (last tier ends at ${expectedFrom - 1})`);
  }
  return tiers;
}

/**
 * The percentile formula every rank beyond the podium is paid off. Exported
 * so a caller can preview/audit a single rank's tier without re-deriving
 * the ceiling math.
 * @param {number} rank 1-based
 * @param {number} totalEntrants
 * @returns {number} an integer in [1, 100]
 */
export function percentileForRank(rank, totalEntrants) {
  return Math.ceil((rank * 100) / totalEntrants);
}

function findTier(pct, percentileRewards) {
  const tier = percentileRewards.find((t) => pct >= t.fromPct && pct <= t.toPct);
  if (!tier) {
    // Should be unreachable for a config that passed validatePercentileCoverage()
    // — surfaced loudly rather than silently paying nothing.
    throw new Error(`no percentile tier covers pct ${pct} — percentileRewards must cover 1-100`);
  }
  return tier;
}

/**
 * Resolve every entrant's reward list from their final placement.
 * @param {{entrantId:string, rank:number}[]} placements shared/rules/
 *   bracket.js's placements() output — ranks 1..N, no gaps, no ties
 * @param {{positionRewards?:object, percentileRewards:object[]}} config
 * @returns {{trainerId:string, rewards:object[]}[]}
 */
export function resolveRewards(placements, config) {
  const total = placements.length;
  const positionRewards = config?.positionRewards ?? {};
  const percentileRewards = config?.percentileRewards ?? [];

  return placements.map(({ entrantId, rank }) => {
    if (rank <= 3) {
      return { trainerId: entrantId, rewards: positionRewards[rank] ?? [] };
    }
    const pct = percentileForRank(rank, total);
    return { trainerId: entrantId, rewards: findTier(pct, percentileRewards).rewards };
  });
}
