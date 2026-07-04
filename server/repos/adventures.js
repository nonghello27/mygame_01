// SQL for Adventure (Phase 7.4 step B): the enabled route list, one session
// per trainer (at most one 'active' row — db/migrations/011_adventures.sql's
// partial unique index is the DB-level guarantee), and the party's busy lock.
// Only server/services/adventure.js calls these — the rules (map generation,
// node resolution, lazy expiry, compensating releases) live there, the
// queries live here. Same division of labor as server/repos/summons.js.

function shapeSession(r) {
  return {
    id: Number(r.id),
    trainerId: Number(r.trainer_id),
    adventureId: r.adventure_id,
    seed: Number(r.seed),
    map: r.map,
    party: r.party,
    position: r.position,
    state: r.state,
    loot: r.loot,
    endsAt: r.ends_at,
  };
}

/** Enabled routes only — what the state read offers a trainer. `config` rides
 *  along here (the service is what strips it before it ever reaches the
 *  client — see getState()'s public projection). */
export async function listEnabledAdventureDefs(sql) {
  const rows = await sql`
    SELECT id, name, description, config FROM adventure_defs WHERE enabled ORDER BY id`;
  return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, config: r.config }));
}

/** One route's full detail, including `enabled` — start() needs that flag
 *  itself (a disabled/unknown route both 404, same no-leak precedent as
 *  the Summon Hall's getSummonDef). */
export async function getAdventureDef(sql, id) {
  const rows = await sql`
    SELECT id, name, description, config, enabled FROM adventure_defs WHERE id = ${id}`;
  if (!rows[0]) return null;
  const r = rows[0];
  return { id: r.id, name: r.name, description: r.description, config: r.config, enabled: r.enabled };
}

/** The trainer's one 'active' session, or null — the partial unique index
 *  guarantees there is at most one. */
export async function getActiveSession(sql, trainerId) {
  const rows = await sql`
    SELECT id, trainer_id, adventure_id, seed, map, party, position, state, loot, ends_at
    FROM adventure_sessions WHERE trainer_id = ${trainerId} AND state = 'active'`;
  return rows[0] ? shapeSession(rows[0]) : null;
}

/**
 * Mint a new session row (state 'active', position 0). Guarded only by
 * `adventure_sessions_one_active_idx` — a race loses this INSERT with a
 * unique-violation (code 23505), which the SERVICE (not this repo, unlike
 * server/repos/pvp.js insertSeason's precedent) catches and turns into a 409,
 * per this task's design.
 */
export async function insertSession(sql, { trainerId, adventureId, seed, map, party, hours }) {
  const rows = await sql`
    INSERT INTO adventure_sessions (trainer_id, adventure_id, seed, map, party, position, state, loot, ends_at)
    VALUES (${trainerId}, ${adventureId}, ${seed}, ${JSON.stringify(map)}::jsonb,
            ${JSON.stringify(party)}::jsonb, 0, 'active', '[]'::jsonb,
            now() + make_interval(hours => ${hours}))
    RETURNING id, trainer_id, adventure_id, seed, map, party, position, state, loot, ends_at`;
  return shapeSession(rows[0]);
}

/**
 * Advance one step — the exactly-once gate for move(), same philosophy as
 * matches.js's claimResolve: the WHERE clause re-checks ownership, `active`,
 * AND that `position` still matches what the caller read. A raced
 * double-POST's second request reads the same `expectedPosition` and loses.
 * @returns {Promise<number|null>} the NEW position, or null when the claim lost.
 */
export async function claimAdvance(sql, sessionId, trainerId, expectedPosition) {
  const rows = await sql`
    UPDATE adventure_sessions
    SET position = position + 1, updated_at = now()
    WHERE id = ${sessionId} AND trainer_id = ${trainerId}
      AND state = 'active' AND position = ${expectedPosition}
    RETURNING position`;
  return rows[0] ? Number(rows[0].position) : null;
}

/**
 * Persist one move's outcome: append `lootAppend` (an array of one log
 * entry, wrapped so `||` concatenates two jsonb arrays rather than nesting)
 * to the running loot log, and optionally flip to a terminal `state` — one
 * statement, no separate read-then-write. `state` omitted (undefined/null)
 * leaves the row's current state untouched (the COALESCE), which is what a
 * non-terminal move (still 'active') needs.
 * @returns the refreshed session row.
 */
export async function settleSession(sql, sessionId, { state = null, lootAppend }) {
  const rows = await sql`
    UPDATE adventure_sessions
    SET loot = loot || ${JSON.stringify(lootAppend)}::jsonb,
        state = COALESCE(${state}::text, state),
        updated_at = now()
    WHERE id = ${sessionId}
    RETURNING id, trainer_id, adventure_id, seed, map, party, position, state, loot, ends_at`;
  return rows[0] ? shapeSession(rows[0]) : null;
}

/**
 * Guarded UPDATE for abandon(): 'active' -> 'abandoned', same shape as
 * claimAdvance (id + trainer + state='active' is the whole gate) but not
 * listed alongside claimAdvance/settleSession in this task's original repo
 * function list — added because abandon() needs its own atomic claim rather
 * than reusing settleSession's unguarded WHERE (move()'s claimAdvance is
 * already that gate for move(), but abandon() has no earlier claim step).
 * @returns the refreshed session row, or null when the claim lost (already
 *   resolved/abandoned by a racing request).
 */
export async function claimAbandon(sql, sessionId, trainerId) {
  const rows = await sql`
    UPDATE adventure_sessions
    SET state = 'abandoned', updated_at = now()
    WHERE id = ${sessionId} AND trainer_id = ${trainerId} AND state = 'active'
    RETURNING id, trainer_id, adventure_id, seed, map, party, position, state, loot, ends_at`;
  return rows[0] ? shapeSession(rows[0]) : null;
}

/**
 * The lazy-time valve (CLAUDE.md §1.5): any 'active' session whose ends_at
 * has passed is marked 'abandoned'. No compensating releaseParty call here —
 * the party's own busy_until was minted to match ends_at exactly (same
 * lock+timer pairing as activities' claimMonsterForJob/insertActivity), so
 * it has already lapsed on its own by the time this fires; a fresh
 * claimMonsterForJob/claimPartyForAdventure call reads it as free again.
 */
export async function expireStaleSessions(sql, trainerId) {
  const rows = await sql`
    UPDATE adventure_sessions
    SET state = 'abandoned', updated_at = now()
    WHERE trainer_id = ${trainerId} AND state = 'active' AND ends_at <= now()
    RETURNING id`;
  return rows.length;
}

/**
 * Take the busy lock for every monster in the party, atomically, in ONE
 * statement — same claim shape as server/repos/monsters.js
 * claimMonsterForJob, widened to a set of ids. Only ids that are BOTH owned
 * by this trainer AND currently free come back; the service checks it got
 * all of them (fewer means a partial claim that must be released, never
 * left half-locked).
 */
export async function claimPartyForAdventure(sql, trainerId, monsterIds, durationS) {
  const rows = await sql`
    UPDATE monsters
    SET busy_until = now() + make_interval(secs => ${durationS}), busy_kind = 'adventure'
    WHERE id = ANY(${monsterIds}::bigint[]) AND trainer_id = ${trainerId}
      AND (busy_until IS NULL OR busy_until <= now())
    RETURNING id`;
  return rows.map((r) => Number(r.id));
}

/**
 * Free the party's busy lock. Guarded on `busy_kind = 'adventure'` so this
 * can never clear a work/training lock it doesn't own — a monster whose lock
 * changed kind since the session snapshot froze (shouldn't happen, since a
 * busy monster can't be claimed for a second job) is simply left alone.
 */
export async function releaseParty(sql, trainerId, monsterIds) {
  await sql`
    UPDATE monsters
    SET busy_until = NULL, busy_kind = NULL
    WHERE id = ANY(${monsterIds}::bigint[]) AND trainer_id = ${trainerId} AND busy_kind = 'adventure'`;
}
