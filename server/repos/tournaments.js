// SQL for Tournaments (Phase 9.2: schema, admin lifecycle, registration).
// Only server/services/tournament.js calls these — the rules (validation,
// the claim-first-then-pay registration flow, LIFO compensation) live there,
// the queries live here. Same division of labor as server/repos/adventures.js
// (whose claimPartyForAdventure/releaseParty pair this module's
// claimPartyForTournament/releaseTournamentParty mirror almost verbatim).
//
// Bracket generation/round settlement (tournament_matches writes) is 9.3's
// job — this file only reads/writes tournaments and tournament_entries.

function shapeTournament(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    name: r.name,
    description: r.description,
    regStartsAt: r.reg_starts_at,
    regEndsAt: r.reg_ends_at,
    seed: Number(r.seed),
    rewards: r.rewards,
    entryFee: Number(r.entry_fee),
    status: r.status,
    standings: r.standings,
    createdAt: r.created_at,
    // Only present on rows selected with the entrant-count JOIN below —
    // absent (undefined) elsewhere, which callers that don't need it ignore.
    ...(r.entrant_count !== undefined ? { entrantCount: Number(r.entrant_count) } : {}),
  };
}

function shapeEntry(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    tournamentId: Number(r.tournament_id),
    trainerId: Number(r.trainer_id),
    team: r.team,
    monsterIds: (r.monster_ids ?? []).map(Number),
    feePaid: Number(r.fee_paid),
    refunded: r.refunded === true,
    enteredAt: r.entered_at,
  };
}

/**
 * Mint a new tournament row (status always 'scheduled' at creation — see
 * server/services/tournament.js's adminCreate header for why status never
 * starts anywhere else).
 */
export async function insertTournament(sql, { name, description, regStartsAt, regEndsAt, seed, rewards, entryFee }) {
  const rows = await sql`
    INSERT INTO tournaments (name, description, reg_starts_at, reg_ends_at, seed, rewards, entry_fee, status)
    VALUES (${name}, ${description}, ${regStartsAt}, ${regEndsAt}, ${seed},
            ${JSON.stringify(rewards)}::jsonb, ${entryFee}, 'scheduled')
    RETURNING id, name, description, reg_starts_at, reg_ends_at, seed, rewards, entry_fee, status, standings, created_at`;
  return shapeTournament(rows[0]);
}

/**
 * Every tournament (any status — cancelled/completed stay visible as
 * history), newest first, each carrying its live entrant count via a LEFT
 * JOIN + GROUP BY (one query, no N+1). Shared by the player list
 * (server/services/tournament.js's listTournaments) and the admin list.
 */
export async function listTournamentsWithCounts(sql) {
  const rows = await sql`
    SELECT t.id, t.name, t.description, t.reg_starts_at, t.reg_ends_at, t.seed, t.rewards,
           t.entry_fee, t.status, t.standings, t.created_at,
           COUNT(e.id)::int AS entrant_count
    FROM tournaments t
    LEFT JOIN tournament_entries e ON e.tournament_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at DESC`;
  return rows.map(shapeTournament);
}

/** One tournament by id, or null. */
export async function getTournamentById(sql, id) {
  const rows = await sql`
    SELECT id, name, description, reg_starts_at, reg_ends_at, seed, rewards,
           entry_fee, status, standings, created_at
    FROM tournaments WHERE id = ${id}`;
  return shapeTournament(rows[0]);
}

/**
 * The claimed cancel: any status EXCEPT the two terminal ones flips to
 * 'cancelled' in one guarded statement — this IS the whole gate (no
 * pre-read-then-write race window). A NOTE for 9.3: cancelling mid-'running'
 * is allowed here (the WHERE only excludes 'completed'/'cancelled') — 9.3's
 * settlement loop must check for a 'cancelled' status before resolving
 * another round so a cancel mid-bracket actually stops it.
 * @returns the refreshed row, or null when the claim lost (already
 *   completed/cancelled).
 */
export async function claimCancelTournament(sql, id) {
  const rows = await sql`
    UPDATE tournaments SET status = 'cancelled'
    WHERE id = ${id} AND status NOT IN ('completed', 'cancelled')
    RETURNING id, name, description, reg_starts_at, reg_ends_at, seed, rewards,
              entry_fee, status, standings, created_at`;
  return shapeTournament(rows[0]);
}

/** Every entry for one tournament — adminCancel's refund/release loop walks this. */
export async function listEntriesForTournament(sql, tournamentId) {
  const rows = await sql`
    SELECT id, tournament_id, trainer_id, team, monster_ids, fee_paid, refunded, entered_at
    FROM tournament_entries WHERE tournament_id = ${tournamentId}`;
  return rows.map(shapeEntry);
}

/**
 * One trainer's entry in one tournament, or null — the withdraw/register
 * pre-checks and the panel's "my entry" read all use this shape.
 */
export async function getEntry(sql, tournamentId, trainerId) {
  const rows = await sql`
    SELECT id, tournament_id, trainer_id, team, monster_ids, fee_paid, refunded, entered_at
    FROM tournament_entries WHERE tournament_id = ${tournamentId} AND trainer_id = ${trainerId}`;
  return shapeEntry(rows[0]);
}

/**
 * Every entry a trainer has ever made, across all tournaments — one query
 * for listTournaments() to fold in as each row's "my entry" summary, rather
 * than N+1 per tournament.
 * @returns {Promise<Map<number, object>>} tournamentId -> shaped entry
 */
export async function listMyEntriesByTournament(sql, trainerId) {
  const rows = await sql`
    SELECT id, tournament_id, trainer_id, team, monster_ids, fee_paid, refunded, entered_at
    FROM tournament_entries WHERE trainer_id = ${trainerId}`;
  return new Map(rows.map((r) => [Number(r.tournament_id), shapeEntry(r)]));
}

/**
 * Insert one registration. UNIQUE(tournament_id, trainer_id) is the
 * double-register guard — a race loses this INSERT with a unique-violation
 * (code 23505), which the SERVICE catches and turns into a 409 (same split
 * as adventures.js insertSession's header describes for its own unique
 * index).
 */
export async function insertEntry(sql, { tournamentId, trainerId, team, monsterIds, feePaid }) {
  const rows = await sql`
    INSERT INTO tournament_entries (tournament_id, trainer_id, team, monster_ids, fee_paid)
    VALUES (${tournamentId}, ${trainerId}, ${JSON.stringify(team)}::jsonb, ${monsterIds}::bigint[], ${feePaid})
    RETURNING id, tournament_id, trainer_id, team, monster_ids, fee_paid, refunded, entered_at`;
  return shapeEntry(rows[0]);
}

/**
 * The withdraw claim: guarded DELETE, id/trainer implied by the WHERE — the
 * whole gate. Returns the deleted row (so the service knows monsterIds/
 * feePaid to release/refund) or null when there was no such entry (already
 * withdrawn, never registered, or — see the `refunded = false` guard below —
 * already cancelled-and-refunded out from under this withdraw).
 *
 * `AND refunded = false` is the anti-race guard against a CONCURRENT admin
 * cancel: without it, this interleaving double-pays a fee refund —
 * withdraw reads the tournament while it's still 'scheduled' -> admin
 * cancel flips it to 'cancelled' and wins `claimRefundEntry` for this same
 * entry (gold refunded, locks released) -> this DELETE, having no
 * `refunded` check, would still return the row and withdraw()'s caller
 * would refund `fee_paid` a SECOND time. With the guard, that same
 * interleaving instead makes this DELETE match nothing (refunded is already
 * true), so withdraw() correctly sees "no entry" and pays nothing.
 * The REVERSE interleaving is already safe with no extra guard needed: if
 * this DELETE wins first, the entry row is gone, so a subsequent
 * `claimRefundEntry` (keyed by entry id) simply finds no row to flip.
 */
export async function claimWithdrawEntry(sql, tournamentId, trainerId) {
  const rows = await sql`
    DELETE FROM tournament_entries
    WHERE tournament_id = ${tournamentId} AND trainer_id = ${trainerId} AND refunded = false
    RETURNING id, tournament_id, trainer_id, team, monster_ids, fee_paid, refunded, entered_at`;
  return shapeEntry(rows[0]);
}

/**
 * The idempotent per-entry refund claim adminCancel's loop uses: flips
 * refunded false->true in one guarded statement. Returns the row (so the
 * caller reads feePaid/trainerId/monsterIds to actually credit/release) only
 * when THIS call won the flip — a second call (a re-run cancel after a
 * crash) sees refunded already true and gets null, so it neither
 * double-credits gold nor re-releases an already-released lock.
 */
export async function claimRefundEntry(sql, entryId) {
  const rows = await sql`
    UPDATE tournament_entries SET refunded = true
    WHERE id = ${entryId} AND refunded = false
    RETURNING id, tournament_id, trainer_id, team, monster_ids, fee_paid, refunded, entered_at`;
  return shapeEntry(rows[0]);
}

// --- the party busy-lock pair (busy_kind = 'tournament') --------------------
//
// Same atomic-claim shape as server/repos/adventures.js's
// claimPartyForAdventure/releaseParty, with one difference: an adventure's
// busy_until is a real, short-lived deadline (the run's own ends_at); a
// tournament has no fixed duration yet (registration -> running -> the whole
// bracket could take anywhere from minutes to days once 9.3 resolves it
// round by round), so busy_until here is only a BACKSTOP — a far-future
// timestamp that guarantees a crashed/abandoned tournament can never leave a
// monster locked forever, without ever being the mechanism that actually
// frees it. The REAL release is always one of: withdraw (claimWithdrawEntry
// + releaseTournamentParty), admin cancel (same), or 9.3's eventual
// settlement — every one of them an explicit, guarded UPDATE, never a wait
// for busy_until to lapse.

/**
 * Claim all 3 (or however many) monster ids atomically. Only ids that are
 * BOTH owned by this trainer AND currently free come back — the service
 * checks it got every id it asked for; a partial claim must be released
 * (never left half-locked), same contract as claimPartyForAdventure.
 */
export async function claimPartyForTournament(sql, trainerId, monsterIds) {
  const rows = await sql`
    UPDATE monsters
    SET busy_until = now() + interval '1 year', busy_kind = 'tournament'
    WHERE id = ANY(${monsterIds}::bigint[]) AND trainer_id = ${trainerId}
      AND (busy_until IS NULL OR busy_until <= now())
    RETURNING id`;
  return rows.map((r) => Number(r.id));
}

/**
 * Free the party's busy lock. Guarded on `busy_kind = 'tournament'` so this
 * can never clear a work/training/adventure lock it doesn't own.
 */
export async function releaseTournamentParty(sql, trainerId, monsterIds) {
  await sql`
    UPDATE monsters
    SET busy_until = NULL, busy_kind = NULL
    WHERE id = ANY(${monsterIds}::bigint[]) AND trainer_id = ${trainerId} AND busy_kind = 'tournament'`;
}
