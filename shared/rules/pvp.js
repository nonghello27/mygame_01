// PVP ladder math (Phase 6 step 4): Elo rating updates and season-end reward
// tiers. Pure — no DB, no I/O — so server/services/pvp.js can call it against
// freshly-read ratings and the client can import the SAME module to render
// the ladder without re-deriving the formula (CLAUDE.md §1: one source of
// truth for numbers a player sees).

export const PVP_RATING_START = 1000;
export const ELO_K = 32;
export const SEASON_LENGTH_DAYS = 14;

/**
 * Standard Elo delta for the FIRST player (A), given both current ratings and
 * A's match score (1 = win, 0.5 = draw, 0 = loss).
 *
 * B's delta is NOT -delta(A) — call this again with the arguments swapped
 * (ratingB, ratingA, 1 - scoreA) and let each side round independently.
 * Rounding two independent Math.round() calls is not guaranteed to sum to
 * zero (e.g. a fractional expected score can round both deltas the "wrong"
 * way at a K-step boundary), so the two are near-mirrors, not exact ones —
 * both get stored, never inferred from one another.
 */
export function eloDelta(ratingA, ratingB, scoreA) {
  const expectedA = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  return Math.round(ELO_K * (scoreA - expectedA));
}

/**
 * Season-end gold payout for a trainer's final rank. A trainer who played no
 * games this season earns nothing, no matter what their (default) rank is.
 */
export function seasonRewardGold(rank, games) {
  if (games === 0) return 0;
  if (rank === 1) return 500;
  if (rank <= 3) return 300;
  if (rank <= 10) return 150;
  return 50;
}
