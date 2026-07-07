// SQL for GVG events (Phase 9.5: schedule, team submission, lineup). Only
// server/services/gvg.js calls these — the rules (validation, the
// claim-first-then-pay team submission flow, role re-derivation) live there,
// the queries live here. Same division of labor as server/repos/
// tournaments.js (whose claimPartyForTournament/releaseTournamentParty pair
// this module's claimPartyForGvg/releaseGvgParty mirror almost verbatim).
//
// Battle resolution (gvg_wars writes) is 9.7's job — this file only reads/
// writes gvg_events, gvg_teams, and gvg_registrations.

function shapeEvent(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    name: r.name,
    description: r.description,
    regStartsAt: r.reg_starts_at,
    regEndsAt: r.reg_ends_at,
    seed: Number(r.seed),
    rewards: r.rewards,
    minTeams: Number(r.min_teams),
    maxTeams: Number(r.max_teams),
    status: r.status,
    standings: r.standings,
    createdAt: r.created_at,
    // Only present on rows selected with the registered-guild-count JOIN
    // below — absent (undefined) elsewhere, which callers that don't need it
    // ignore.
    ...(r.registered_guild_count !== undefined ? { registeredGuildCount: Number(r.registered_guild_count) } : {}),
  };
}

function shapeTeam(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    eventId: Number(r.event_id),
    guildId: Number(r.guild_id),
    trainerId: Number(r.trainer_id),
    team: r.team,
    monsterIds: (r.monster_ids ?? []).map(Number),
    battleOrder: r.battle_order === null || r.battle_order === undefined ? null : Number(r.battle_order),
    released: r.released === true,
    submittedAt: r.submitted_at,
    // Only present on rows selected with the trainers JOIN below.
    ...(r.trainer_name !== undefined ? { trainerName: r.trainer_name } : {}),
  };
}

function shapeRegistration(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    eventId: Number(r.event_id),
    guildId: Number(r.guild_id),
    registeredBy: Number(r.registered_by),
    registeredAt: r.registered_at,
  };
}

// --- gvg_events CRUD ----------------------------------------------------------

/**
 * Mint a new GVG event row (status always 'scheduled' at creation — see
 * server/services/tournament.js's adminCreate header for why status never
 * starts anywhere else; server/services/gvg.js's adminCreate mirrors it).
 */
export async function insertGvgEvent(sql, { name, description, regStartsAt, regEndsAt, seed, rewards, minTeams, maxTeams }) {
  const rows = await sql`
    INSERT INTO gvg_events (name, description, reg_starts_at, reg_ends_at, seed, rewards, min_teams, max_teams, status)
    VALUES (${name}, ${description}, ${regStartsAt}, ${regEndsAt}, ${seed},
            ${JSON.stringify(rewards)}::jsonb, ${minTeams}, ${maxTeams}, 'scheduled')
    RETURNING id, name, description, reg_starts_at, reg_ends_at, seed, rewards,
              min_teams, max_teams, status, standings, created_at`;
  return shapeEvent(rows[0]);
}

/**
 * Every GVG event (any status — cancelled/completed stay visible as
 * history), newest first, each carrying its live registered-guild count via a
 * LEFT JOIN + GROUP BY (one query, no N+1) — the listTournamentsWithCounts
 * shape. Shared by the player list (server/services/gvg.js's listGvgEvents)
 * and the admin list.
 */
export async function listGvgEventsWithCounts(sql) {
  const rows = await sql`
    SELECT e.id, e.name, e.description, e.reg_starts_at, e.reg_ends_at, e.seed, e.rewards,
           e.min_teams, e.max_teams, e.status, e.standings, e.created_at,
           COUNT(r.id)::int AS registered_guild_count
    FROM gvg_events e
    LEFT JOIN gvg_registrations r ON r.event_id = e.id
    GROUP BY e.id
    ORDER BY e.created_at DESC`;
  return rows.map(shapeEvent);
}

/** One GVG event by id, or null. */
export async function getGvgEventById(sql, id) {
  const rows = await sql`
    SELECT id, name, description, reg_starts_at, reg_ends_at, seed, rewards,
           min_teams, max_teams, status, standings, created_at
    FROM gvg_events WHERE id = ${id}`;
  return shapeEvent(rows[0]);
}

/**
 * The claimed cancel: any status EXCEPT the two terminal ones flips to
 * 'cancelled' in one guarded statement — the claimCancelTournament shape.
 * @returns the refreshed row, or null when the claim lost (already
 *   completed/cancelled).
 */
export async function claimCancelGvgEvent(sql, id) {
  const rows = await sql`
    UPDATE gvg_events SET status = 'cancelled'
    WHERE id = ${id} AND status NOT IN ('completed', 'cancelled')
    RETURNING id, name, description, reg_starts_at, reg_ends_at, seed, rewards,
              min_teams, max_teams, status, standings, created_at`;
  return shapeEvent(rows[0]);
}

/**
 * Cosmetic status walk: flip scheduled -> registration for events whose
 * window has actually opened. Team submission itself was NEVER gated on this
 * (server/services/gvg.js's REGISTRABLE_STATUSES already accepts both
 * statuses) — this only keeps the DISPLAYED status truthful for the panel/
 * admin tab, the openRegistrationWindows shape.
 */
export async function openGvgRegistrationWindows(sql) {
  await sql`
    UPDATE gvg_events SET status = 'registration'
    WHERE status = 'scheduled' AND reg_starts_at <= now() AND reg_ends_at >= now()`;
}

/**
 * Events due for a lazy settlement pass: a registration window that has
 * closed (whatever its cosmetic status — 'scheduled' or 'registration', both
 * pre-bracket). NOTE, unlike tournaments: this phase (9.5) does NOT advance
 * status past 'registration' — the running/completed walk is 9.7's
 * settleGvg(); until then a closed event just stays 'registration' and each
 * settlement pass here only releases whatever unpicked/unregistered teams'
 * locks are still outstanding. Because every team's `released` flag makes a
 * re-visit cheap and idempotent, revisiting an already-fully-released event
 * on every later read costs nothing but a query. `gvg_events_status_idx`
 * serves this without a table scan.
 */
export async function listDueGvgEvents(sql) {
  const rows = await sql`
    SELECT id, name, description, reg_starts_at, reg_ends_at, seed, rewards,
           min_teams, max_teams, status, standings, created_at
    FROM gvg_events
    WHERE status IN ('scheduled', 'registration') AND reg_ends_at < now()
    ORDER BY id`;
  return rows.map(shapeEvent);
}

// --- gvg_teams: submission / withdraw / lineup --------------------------------

/**
 * Insert one submitted team. UNIQUE(event_id, trainer_id) is the
 * double-submit guard — a race loses this INSERT as a 23505, which the
 * service turns into a 409.
 */
export async function insertGvgTeam(sql, { eventId, guildId, trainerId, team, monsterIds }) {
  const rows = await sql`
    INSERT INTO gvg_teams (event_id, guild_id, trainer_id, team, monster_ids)
    VALUES (${eventId}, ${guildId}, ${trainerId}, ${JSON.stringify(team)}::jsonb, ${monsterIds}::bigint[])
    RETURNING id, event_id, guild_id, trainer_id, team, monster_ids, battle_order, released, submitted_at`;
  return shapeTeam(rows[0]);
}

/** The caller's own submitted team for one event, or null. */
export async function getMyGvgTeam(sql, eventId, trainerId) {
  const rows = await sql`
    SELECT id, event_id, guild_id, trainer_id, team, monster_ids, battle_order, released, submitted_at
    FROM gvg_teams WHERE event_id = ${eventId} AND trainer_id = ${trainerId}`;
  return shapeTeam(rows[0]);
}

/**
 * Every team a guild has submitted for one event, ordered by id ASC, joined
 * with the submitting trainer's name — the leader's pick list.
 */
export async function listGvgTeamsForGuild(sql, eventId, guildId) {
  const rows = await sql`
    SELECT t.id, t.event_id, t.guild_id, t.trainer_id, t.team, t.monster_ids,
           t.battle_order, t.released, t.submitted_at, tr.name AS trainer_name
    FROM gvg_teams t JOIN trainers tr ON tr.id = t.trainer_id
    WHERE t.event_id = ${eventId} AND t.guild_id = ${guildId}
    ORDER BY t.id`;
  return rows.map(shapeTeam);
}

/**
 * Every team a trainer has ever submitted, across all GVG events, one query
 * for listGvgEvents() to fold in as each event's "my team" summary — the
 * listMyEntriesByTournament shape.
 * @returns {Promise<Map<number, object>>} eventId -> shaped team
 */
export async function listMyGvgTeamsByEvent(sql, trainerId) {
  const rows = await sql`
    SELECT id, event_id, guild_id, trainer_id, team, monster_ids, battle_order, released, submitted_at
    FROM gvg_teams WHERE trainer_id = ${trainerId}`;
  return new Map(rows.map((r) => [Number(r.event_id), shapeTeam(r)]));
}

/**
 * The withdraw claim: guarded DELETE — `battle_order IS NULL` folds "can't
 * withdraw a picked team" into the claim itself (a leader must unpick it
 * first), and `released = false` is the same anti-race guard against a
 * concurrent cancel/settlement release that claimWithdrawEntry documents for
 * `refunded` (server/repos/tournaments.js): without it, a settlement pass
 * that already released this team's lock could have this DELETE still match
 * and try to release it a second time.
 * @returns the deleted row, or null when there was no such withdrawable team.
 */
export async function claimWithdrawGvgTeam(sql, eventId, trainerId) {
  const rows = await sql`
    DELETE FROM gvg_teams
    WHERE event_id = ${eventId} AND trainer_id = ${trainerId} AND battle_order IS NULL AND released = false
    RETURNING id, event_id, guild_id, trainer_id, team, monster_ids, battle_order, released, submitted_at`;
  return shapeTeam(rows[0]);
}

/** Clear a guild's whole lineup for one event (the first of setLineup()'s two
 *  steps — see server/services/gvg.js's setLineup for why this isn't atomic
 *  with the per-team sets that follow). */
export async function clearGvgLineup(sql, eventId, guildId) {
  await sql`UPDATE gvg_teams SET battle_order = NULL WHERE event_id = ${eventId} AND guild_id = ${guildId}`;
}

/**
 * Set one team's lineup slot. `guild_id` is folded into the WHERE (not just
 * `id`) so a leader can never order another guild's team even if a stale
 * client sent a foreign team id; `released = false` keeps an already-released
 * (settled-away) team from being re-added to a lineup.
 * @returns the team's id, or null on a lost/invalid claim
 */
export async function setGvgTeamOrder(sql, eventId, guildId, teamId, order) {
  const rows = await sql`
    UPDATE gvg_teams SET battle_order = ${order}
    WHERE id = ${teamId} AND event_id = ${eventId} AND guild_id = ${guildId} AND released = false
    RETURNING id`;
  return rows[0] ? Number(rows[0].id) : null;
}

// --- the party busy-lock pair (busy_kind = 'gvg') -----------------------------
//
// Same atomic-claim shape as server/repos/tournaments.js's
// claimPartyForTournament/releaseTournamentParty: busy_until here is only a
// BACKSTOP — a far-future timestamp guaranteeing a crashed/abandoned event
// can never leave a monster locked forever, without ever being the mechanism
// that actually frees it. The REAL release is always an explicit, guarded
// UPDATE: withdraw, admin cancel, or window-close settlement's release walk.

/**
 * Claim all 3 (or however many) monster ids atomically. Only ids that are
 * BOTH owned by this trainer AND currently free come back — the service
 * checks it got every id it asked for; a partial claim must be released
 * (never left half-locked), same contract as claimPartyForTournament.
 */
export async function claimPartyForGvg(sql, trainerId, monsterIds) {
  const rows = await sql`
    UPDATE monsters
    SET busy_until = now() + interval '1 year', busy_kind = 'gvg'
    WHERE id = ANY(${monsterIds}::bigint[]) AND trainer_id = ${trainerId}
      AND (busy_until IS NULL OR busy_until <= now())
    RETURNING id`;
  return rows.map((r) => Number(r.id));
}

/**
 * Free the party's busy lock. Guarded on `busy_kind = 'gvg'` so this can
 * never clear a work/training/adventure/tournament lock it doesn't own.
 */
export async function releaseGvgParty(sql, trainerId, monsterIds) {
  await sql`
    UPDATE monsters
    SET busy_until = NULL, busy_kind = NULL
    WHERE id = ANY(${monsterIds}::bigint[]) AND trainer_id = ${trainerId} AND busy_kind = 'gvg'`;
}

// --- gvg_registrations ---------------------------------------------------------

/**
 * Insert one guild registration. UNIQUE(event_id, guild_id) is the
 * double-register guard — a race registering twice loses this INSERT as a
 * 23505, which the service turns into a 409.
 */
export async function insertGvgRegistration(sql, { eventId, guildId, registeredBy }) {
  const rows = await sql`
    INSERT INTO gvg_registrations (event_id, guild_id, registered_by)
    VALUES (${eventId}, ${guildId}, ${registeredBy})
    RETURNING id, event_id, guild_id, registered_by, registered_at`;
  return shapeRegistration(rows[0]);
}

/** One guild's registration for one event, or null. */
export async function getGvgRegistration(sql, eventId, guildId) {
  const rows = await sql`
    SELECT id, event_id, guild_id, registered_by, registered_at
    FROM gvg_registrations WHERE event_id = ${eventId} AND guild_id = ${guildId}`;
  return shapeRegistration(rows[0]);
}

/**
 * Every GVG registration a guild has ever made, across all events — one
 * query for listGvgEvents() to fold in as each event's "is my guild
 * registered" flag, rather than N+1 per event.
 * @returns {Promise<Map<number, object>>} eventId -> shaped registration
 */
export async function listGvgRegistrationsByGuild(sql, guildId) {
  const rows = await sql`
    SELECT id, event_id, guild_id, registered_by, registered_at
    FROM gvg_registrations WHERE guild_id = ${guildId}`;
  return new Map(rows.map((r) => [Number(r.event_id), shapeRegistration(r)]));
}

// --- release walks: settlement + admin cancel ---------------------------------

/**
 * The idempotent per-team release claim window-close settlement and admin
 * cancel both use: flips `released` false->true in one guarded statement.
 * Returns the row (so the caller reads trainerId/monsterIds to actually
 * release the busy lock) only when THIS call won the flip — a second call (a
 * re-run pass after a crash) sees `released` already true and gets null, so
 * it never double-releases an already-released lock. The claimRefundEntry
 * shape, minus a refund leg (GVG has no fee).
 */
export async function claimReleaseGvgTeam(sql, teamId) {
  const rows = await sql`
    UPDATE gvg_teams SET released = true
    WHERE id = ${teamId} AND released = false
    RETURNING id, event_id, guild_id, trainer_id, team, monster_ids, battle_order, released, submitted_at`;
  return shapeTeam(rows[0]);
}

/** Every not-yet-released team for one event — admin cancel's release walk
 *  (every team, picked or not, gets its lock freed on a full cancel). */
export async function listUnreleasedTeamsForEvent(sql, eventId) {
  const rows = await sql`
    SELECT id, event_id, guild_id, trainer_id, team, monster_ids, battle_order, released, submitted_at
    FROM gvg_teams WHERE event_id = ${eventId} AND released = false
    ORDER BY id`;
  return rows.map(shapeTeam);
}

/**
 * Window-close settlement's release set: not-yet-released teams that are
 * EITHER still unpicked (battle_order IS NULL — never made it into a
 * lineup), OR belong to a guild that never completed registration at all
 * (no gvg_registrations row for this event) — nobody stays locked for a
 * lineup that never fought. A picked team (battle_order set) belonging to a
 * guild that DID register is deliberately excluded here — 9.7's war
 * resolution is what eventually releases those, once their battles are done.
 */
export async function listUnreleasedUnpickedTeamsForEvent(sql, eventId) {
  const rows = await sql`
    SELECT t.id, t.event_id, t.guild_id, t.trainer_id, t.team, t.monster_ids,
           t.battle_order, t.released, t.submitted_at
    FROM gvg_teams t
    WHERE t.event_id = ${eventId} AND t.released = false
      AND (
        t.battle_order IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM gvg_registrations r WHERE r.event_id = t.event_id AND r.guild_id = t.guild_id
        )
      )
    ORDER BY t.id`;
  return rows.map(shapeTeam);
}
