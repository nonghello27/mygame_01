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
    // NULL until settleTournaments() (Phase 9.3) stamps {rank, rewards} via
    // the idempotent claimEntryReward() below — absent from a query that
    // doesn't SELECT it (this codebase's older 9.2 queries) reads as
    // undefined ?? null, same as any freshly-registered entry.
    reward: r.reward ?? null,
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

/**
 * Every entry for one tournament, ordered by id ASC — adminCancel's
 * refund/release loop walks this, and (Phase 9.3) settleTournaments()'s
 * `entrantIds = entries.map(e => String(e.id))` relies on this exact order:
 * the bracket's entrant ORDER (before generateBracket's own seeded shuffle)
 * must be stable and reproducible across settlement passes, and "entry id
 * ascending" is the one order this table already guarantees without an
 * extra column.
 */
export async function listEntriesForTournament(sql, tournamentId) {
  const rows = await sql`
    SELECT id, tournament_id, trainer_id, team, monster_ids, fee_paid, refunded, entered_at, reward
    FROM tournament_entries WHERE tournament_id = ${tournamentId} ORDER BY id`;
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

// --- settlement (Phase 9.3): status walk, bracket persistence, payout ------
//
// Bracket generation/round-by-round resolution lives in
// server/services/tournament.js's settleTournaments() — this half only
// reads/writes tournaments/tournament_entries/tournament_matches for it.

/**
 * Cosmetic status walk: flip scheduled -> registration for tournaments whose
 * window has actually opened. Registration itself was NEVER gated on this
 * (REGISTRABLE_STATUSES in server/services/tournament.js already accepts
 * both statuses) — this only keeps the DISPLAYED status truthful for the
 * panel/admin tab. Bulk (no id needed, no RETURNING read back) — a lost race
 * against a concurrent settlement pass just means the flip already happened.
 */
export async function openRegistrationWindows(sql) {
  await sql`
    UPDATE tournaments SET status = 'registration'
    WHERE status = 'scheduled' AND reg_starts_at <= now() AND reg_ends_at >= now()`;
}

/**
 * Tournaments due for a lazy settlement pass: a registration window that has
 * closed (whatever its cosmetic status — scheduled or registration, both
 * pre-bracket) needs to either auto-cancel or start its bracket; anything
 * already 'running' needs another round resolved, or is ready to complete.
 * `tournaments_status_idx` (014) serves this without a table scan.
 */
export async function listDueTournaments(sql) {
  const rows = await sql`
    SELECT id, name, description, reg_starts_at, reg_ends_at, seed, rewards,
           entry_fee, status, standings, created_at
    FROM tournaments
    WHERE (status IN ('scheduled', 'registration') AND reg_ends_at < now())
       OR status = 'running'
    ORDER BY id`;
  return rows.map(shapeTournament);
}

/**
 * Guarded flip scheduled/registration -> running: the settlement claim that
 * starts a bracket exactly once. A lost claim (null) means another
 * concurrent settlement pass (or a racing admin cancel) already moved this
 * tournament past that pair of statuses — the caller re-reads rather than
 * assuming it won and generating a second, divergent bracket.
 */
export async function claimStartTournament(sql, id) {
  const rows = await sql`
    UPDATE tournaments SET status = 'running'
    WHERE id = ${id} AND status IN ('scheduled', 'registration')
    RETURNING id, name, description, reg_starts_at, reg_ends_at, seed, rewards,
              entry_fee, status, standings, created_at`;
  return shapeTournament(rows[0]);
}

/**
 * Guarded flip running -> completed, stamping the final standings JSONB in
 * the same statement — the LAST step of settlement (server/services/
 * tournament.js), only reached once every entry's reward claim has already
 * been stamped, so a re-run after a crash right before this UPDATE simply
 * finds nothing left to pay and reaches this same call again.
 */
export async function claimCompleteTournament(sql, id, standings) {
  const rows = await sql`
    UPDATE tournaments SET status = 'completed', standings = ${JSON.stringify(standings)}::jsonb
    WHERE id = ${id} AND status = 'running'
    RETURNING id, name, description, reg_starts_at, reg_ends_at, seed, rewards,
              entry_fee, status, standings, created_at`;
  return shapeTournament(rows[0]);
}

/**
 * Insert one resolved pairing. `UNIQUE(tournament_id, round, position)`
 * (014) is the exactly-once-per-pairing claim — `ON CONFLICT DO NOTHING`
 * means a concurrent settlement pass that reached the same pairing first
 * just loses this INSERT (null back). The race LOSER must never re-derive a
 * different winner for the same pairing: a pairing's outcome is fully
 * deterministic from its own stored seed (shared/rules/bracket.js's
 * derivePairingSeed), so whichever caller wins the insert, the winner it
 * computed independently is guaranteed identical — the loser simply skips
 * writing it again.
 * @returns {Promise<number|null>} the new row's id, or null on a lost claim
 */
export async function insertTournamentMatch(sql, { tournamentId, round, position, entryA, entryB, seed, winner, result }) {
  const rows = await sql`
    INSERT INTO tournament_matches (tournament_id, round, position, entry_a, entry_b, seed, winner, result)
    VALUES (${tournamentId}, ${round}, ${position}, ${entryA}, ${entryB ?? null}, ${seed}, ${winner},
            ${JSON.stringify(result)}::jsonb)
    ON CONFLICT (tournament_id, round, position) DO NOTHING
    RETURNING id`;
  return rows[0] ? Number(rows[0].id) : null;
}

/**
 * Every resolved pairing for one tournament — shaped for
 * shared/rules/bracket.js's replayBracket() `results` input (round/position/
 * winner) once the service maps `winner` id -> string, plus the seed/result
 * every other reader (the detail view) needs to display or replay a match.
 */
export async function listMatchesForTournament(sql, tournamentId) {
  const rows = await sql`
    SELECT id, tournament_id, round, position, entry_a, entry_b, seed, winner, result
    FROM tournament_matches WHERE tournament_id = ${tournamentId} ORDER BY round, position`;
  return rows.map((r) => ({
    id: Number(r.id),
    round: r.round,
    position: r.position,
    entryA: r.entry_a === null ? null : Number(r.entry_a),
    entryB: r.entry_b === null ? null : Number(r.entry_b),
    seed: Number(r.seed),
    winner: r.winner === null ? null : Number(r.winner),
    result: r.result,
  }));
}

/**
 * The idempotent per-entry reward claim: `reward IS NULL` is the whole
 * gate, same shape as server/repos/pvp.js's payoutSeason / claimRefundEntry
 * above. A re-run settlement pass (after a crash between stamping this and
 * actually granting/releasing — see settleTournaments()'s own note on that
 * narrow accepted window) sees `reward` already non-NULL and correctly skips
 * granting or releasing this entry a second time.
 * @returns the refreshed entry (so the caller reads trainerId/monsterIds to
 *   grant/release), or null when another settlement pass already won it.
 */
export async function claimEntryReward(sql, entryId, reward) {
  const rows = await sql`
    UPDATE tournament_entries SET reward = ${JSON.stringify(reward)}::jsonb
    WHERE id = ${entryId} AND reward IS NULL
    RETURNING id, tournament_id, trainer_id, team, monster_ids, fee_paid, refunded, entered_at, reward`;
  return shapeEntry(rows[0]);
}

/**
 * Entrants for the detail view: the trainer's name and ONLY the frozen
 * team's `display` field (CLAUDE.md §1.1 — another trainer's stat/lane
 * snapshot is never shipped, `team -> 'display'` never selects `team ->
 * 'lanes'`), plus each entry's stamped reward once payout has run.
 */
export async function listEntrantsForTournament(sql, tournamentId) {
  const rows = await sql`
    SELECT e.id, e.trainer_id, t.name AS trainer_name, e.entered_at,
           e.team -> 'display' AS display, e.reward
    FROM tournament_entries e JOIN trainers t ON t.id = e.trainer_id
    WHERE e.tournament_id = ${tournamentId}
    ORDER BY e.id`;
  return rows.map((r) => ({
    entryId: Number(r.id),
    trainerId: Number(r.trainer_id),
    trainerName: r.trainer_name,
    enteredAt: r.entered_at,
    display: r.display,
    reward: r.reward ?? null,
  }));
}
