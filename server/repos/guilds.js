// SQL for Guilds (Phase 9.4): guilds/guild_members/guild_applications CRUD
// and every guarded claim the service (server/services/guild.js) needs —
// same division of labor as server/repos/tournaments.js: the rules (role
// checks, gold, validation, LIFO compensation) live in the service, only
// queries and row-shaping live here.

function shapeGuild(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    name: r.name,
    description: r.description,
    emblem: r.emblem,
    leaderId: Number(r.leader_id),
    createdAt: r.created_at,
    // Only present on rows selected with the member-count JOIN below —
    // absent (undefined) elsewhere, which callers that don't need it ignore.
    ...(r.member_count !== undefined ? { memberCount: Number(r.member_count) } : {}),
    ...(r.leader_name !== undefined ? { leaderName: r.leader_name } : {}),
  };
}

function shapeMember(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    guildId: Number(r.guild_id),
    trainerId: Number(r.trainer_id),
    role: r.role,
    joinedAt: r.joined_at,
  };
}

function shapeApplication(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    guildId: Number(r.guild_id),
    trainerId: Number(r.trainer_id),
    message: r.message,
    createdAt: r.created_at,
  };
}

// --- guild row CRUD ----------------------------------------------------------

/** Mint a new guild. A duplicate case-insensitive name loses this INSERT as
 *  a 23505 (guilds_name_idx) — the caller (server/services/guild.js create())
 *  turns that into a 409, never pre-checked-then-trusted. */
export async function insertGuild(sql, { name, description, emblem, leaderId }) {
  const rows = await sql`
    INSERT INTO guilds (name, description, emblem, leader_id)
    VALUES (${name}, ${description}, ${emblem}, ${leaderId})
    RETURNING id, name, description, emblem, leader_id, created_at`;
  return shapeGuild(rows[0]);
}

/** Compensation only: undo a won guild insert when the founding member row
 *  fails to insert right after it (the create() LIFO chain). */
export async function deleteGuildById(sql, id) {
  await sql`DELETE FROM guilds WHERE id = ${id}`;
}

export async function getGuildById(sql, id) {
  const rows = await sql`
    SELECT id, name, description, emblem, leader_id, created_at
    FROM guilds WHERE id = ${id}`;
  return shapeGuild(rows[0]);
}

/** Every guild, newest first, with a live member count and the leader's name
 *  in one query (LEFT JOIN + GROUP BY, no N+1) — the browse list. */
export async function listGuildsWithCounts(sql) {
  const rows = await sql`
    SELECT g.id, g.name, g.description, g.emblem, g.leader_id, g.created_at,
      t.name AS leader_name, COUNT(m.id)::int AS member_count
    FROM guilds g
    JOIN trainers t ON t.id = g.leader_id
    LEFT JOIN guild_members m ON m.guild_id = g.id
    GROUP BY g.id, t.name
    ORDER BY g.created_at DESC`;
  return rows.map(shapeGuild);
}

// --- membership --------------------------------------------------------------

/** The caller's own membership row, or null when guildless — the ONE read
 *  every write in server/services/guild.js starts with to re-derive the
 *  caller's role from the DB (CLAUDE.md §1.1: never trust a role from the
 *  request body). */
export async function getMembership(sql, trainerId) {
  const rows = await sql`
    SELECT id, guild_id, trainer_id, role, joined_at
    FROM guild_members WHERE trainer_id = ${trainerId}`;
  return shapeMember(rows[0]);
}

/** One (guild, trainer) membership row, or null — used by transfer() to
 *  confirm the target actually belongs to the caller's own guild. */
export async function getMemberByGuildAndTrainer(sql, guildId, trainerId) {
  const rows = await sql`
    SELECT id, guild_id, trainer_id, role, joined_at
    FROM guild_members WHERE guild_id = ${guildId} AND trainer_id = ${trainerId}`;
  return shapeMember(rows[0]);
}

/** Every member of a guild, joined with the trainer's display name, ordered
 *  leader first, then officers, then members, each group joined_at ASC —
 *  the roster the me() view (and the browse detail, later) renders. */
export async function listMembers(sql, guildId) {
  const rows = await sql`
    SELECT m.trainer_id, t.name, m.role, m.joined_at
    FROM guild_members m JOIN trainers t ON t.id = m.trainer_id
    WHERE m.guild_id = ${guildId}
    ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, m.joined_at`;
  return rows.map((r) => ({
    trainerId: Number(r.trainer_id), name: r.name, role: r.role, joinedAt: r.joined_at,
  }));
}

/** Insert one membership row. UNIQUE(trainer_id) is THE one-guild-per-
 *  trainer race guard — a race between two accepted applications (or a
 *  create racing an accept) loses this INSERT as a 23505, which the service
 *  turns into a 409. Used for both a guild's founding member (role
 *  'leader') and an accepted applicant (role 'member'). */
export async function insertMember(sql, { guildId, trainerId, role }) {
  const rows = await sql`
    INSERT INTO guild_members (guild_id, trainer_id, role)
    VALUES (${guildId}, ${trainerId}, ${role})
    RETURNING id, guild_id, trainer_id, role, joined_at`;
  return shapeMember(rows[0]);
}

/**
 * The leave claim: guarded DELETE, `role <> 'leader'` folded into the WHERE
 * so a leader can never leave through this path (even solo — disbanding a
 * guild is out of scope this phase, per ROADMAP). Returns the deleted row,
 * or null when there was no such non-leader membership (either genuinely not
 * in a guild, or IS the guild's leader — the service already knows which
 * from its own getMembership() read, so it can give the right message).
 */
export async function claimLeave(sql, trainerId) {
  const rows = await sql`
    DELETE FROM guild_members WHERE trainer_id = ${trainerId} AND role <> 'leader'
    RETURNING id, guild_id, trainer_id, role, joined_at`;
  return shapeMember(rows[0]);
}

/**
 * The kick claim: guarded DELETE on (guild, trainer), `role <> 'leader'`
 * folded in the same way — a leader (including the caller, who IS the
 * guild's leader to even reach this call) can never be kicked. Null means
 * "no such member to kick" (never a member of this guild, already left, or
 * — impossible in practice, since only the leader can call kick — is the
 * leader themself).
 */
export async function claimKick(sql, guildId, trainerId) {
  const rows = await sql`
    DELETE FROM guild_members
    WHERE guild_id = ${guildId} AND trainer_id = ${trainerId} AND role <> 'leader'
    RETURNING id, guild_id, trainer_id, role, joined_at`;
  return shapeMember(rows[0]);
}

/**
 * The promote/demote claim: guarded UPDATE, `role <> 'leader'` in the WHERE
 * so this can never touch the leader's own row (leadership only ever moves
 * through claimTransferLeadership below). Null means no such non-leader
 * member in that guild.
 */
export async function updateMemberRole(sql, guildId, trainerId, role) {
  const rows = await sql`
    UPDATE guild_members SET role = ${role}
    WHERE guild_id = ${guildId} AND trainer_id = ${trainerId} AND role <> 'leader'
    RETURNING id, guild_id, trainer_id, role, joined_at`;
  return shapeMember(rows[0]);
}

/**
 * Transfer leadership. THE claim is one guarded UPDATE that folds BOTH
 * preconditions the transfer depends on into its own WHERE, rather than
 * trusting the service's earlier getMemberByGuildAndTrainer() read (which
 * can go stale): `leader_id = caller` (no concurrent transfer already moved
 * leadership out from under this request) AND the target STILL being a
 * guild member right now (`EXISTS (... guild_members ...)` — without this,
 * a target who LEAVES in the gap between that pre-check and this claim
 * would still let the claim win, pointing guilds.leader_id at a non-member
 * with no way to promote them). A lost claim (null) covers either case and
 * touches nothing else.
 *
 * Only once the claim wins does the "promote" UPDATE run — ALSO guarded
 * (`role <> 'leader'`) with its own RETURNING checked, closing the same
 * race narrowed to the gap between the claim above and this statement (the
 * target leaves microseconds later): if it returns no row, this
 * COMPENSATES by reverting guilds.leader_id back to callerId — the
 * caller's own membership row is never touched in that path — and returns
 * null, so a failed transfer leaves the guild exactly as it was before the
 * call.
 *
 * Only after the promote wins does the caller's OWN row demote to
 * 'officer' — deliberately the LAST step, so every step before it still
 * has something clean to compensate. This final demote is the one
 * remaining accepted narrow window this codebase documents elsewhere too
 * (e.g. resolveMatch's Elo/rune-durability note): a crash between the
 * promote committing and this statement running would leave guilds
 * .leader_id correctly pointing at the new leader (who now also holds the
 * 'leader' role at the member-row level) while the caller's own row still
 * says 'leader' too — the guild is never leaderless, only the caller's row
 * lags by one field until a retry or a future admin fix catches up.
 * @returns the refreshed guild row, or null on a lost claim/compensated failure
 */
export async function claimTransferLeadership(sql, { guildId, callerId, newLeaderId }) {
  const claimed = await sql`
    UPDATE guilds SET leader_id = ${newLeaderId}
    WHERE id = ${guildId} AND leader_id = ${callerId}
      AND EXISTS (SELECT 1 FROM guild_members WHERE guild_id = ${guildId} AND trainer_id = ${newLeaderId})
    RETURNING id, name, description, emblem, leader_id, created_at`;
  if (!claimed[0]) return null;

  const promoted = await sql`
    UPDATE guild_members SET role = 'leader'
    WHERE guild_id = ${guildId} AND trainer_id = ${newLeaderId} AND role <> 'leader'
    RETURNING id`;
  if (!promoted[0]) {
    // Compensate: the target left in the residual gap between the claim
    // above and this statement — undo the guilds.leader_id flip so the
    // guild is never left pointing at a non-member; the caller's own row
    // is untouched.
    await sql`UPDATE guilds SET leader_id = ${callerId} WHERE id = ${guildId} AND leader_id = ${newLeaderId}`;
    return null;
  }

  await sql`UPDATE guild_members SET role = 'officer' WHERE guild_id = ${guildId} AND trainer_id = ${callerId}`;
  return shapeGuild(claimed[0]);
}

// --- applications --------------------------------------------------------------

/** Insert one pending application. UNIQUE(guild_id, trainer_id) is the
 *  duplicate-pending-application guard — a race applying twice to the SAME
 *  guild loses this INSERT as a 23505 (the service turns that into a 409;
 *  applying to several DIFFERENT guilds at once is fine, no guard needed). */
export async function insertApplication(sql, { guildId, trainerId, message }) {
  const rows = await sql`
    INSERT INTO guild_applications (guild_id, trainer_id, message)
    VALUES (${guildId}, ${trainerId}, ${message})
    RETURNING id, guild_id, trainer_id, message, created_at`;
  return shapeApplication(rows[0]);
}

/** One application by id, joined with the applicant's display name — accept/
 *  reject read this first to confirm it belongs to the caller's own guild. */
export async function getApplicationById(sql, id) {
  const rows = await sql`
    SELECT a.id, a.guild_id, a.trainer_id, a.message, a.created_at, t.name AS applicant_name
    FROM guild_applications a JOIN trainers t ON t.id = a.trainer_id
    WHERE a.id = ${id}`;
  if (!rows[0]) return null;
  return { ...shapeApplication(rows[0]), applicantName: rows[0].applicant_name };
}

/**
 * The accept/reject claim: guarded DELETE on (id, guild_id) — this IS the
 * whole gate ("belongs to the caller's own guild"), not just a pre-read.
 * Returns the deleted row, or null when it was already gone or belonged to
 * a different guild.
 */
export async function deleteApplicationById(sql, applicationId, guildId) {
  const rows = await sql`
    DELETE FROM guild_applications WHERE id = ${applicationId} AND guild_id = ${guildId}
    RETURNING id, guild_id, trainer_id, message, created_at`;
  return shapeApplication(rows[0]);
}

/** Clean-up only (never a gate): every pending application a trainer has,
 *  across any guild — run after a successful create (they founded their own
 *  guild instead) or a successful accept (every other pending application
 *  they had is now moot, since one-guild-per-trainer already applies). */
export async function deleteApplicationsByTrainer(sql, trainerId) {
  await sql`DELETE FROM guild_applications WHERE trainer_id = ${trainerId}`;
}

/** Every pending application for one guild, joined with the applicant's
 *  name — the leader/officer-only queue in the me() view. */
export async function listApplicationsForGuild(sql, guildId) {
  const rows = await sql`
    SELECT a.id, a.trainer_id, t.name, a.message, a.created_at
    FROM guild_applications a JOIN trainers t ON t.id = a.trainer_id
    WHERE a.guild_id = ${guildId}
    ORDER BY a.created_at`;
  return rows.map((r) => ({
    id: Number(r.id), trainerId: Number(r.trainer_id), name: r.name,
    message: r.message, createdAt: r.created_at,
  }));
}

/** The guildless caller's own pending applications, joined with each
 *  target guild's name — the "you applied here" list the browse view shows. */
export async function listApplicationsByTrainer(sql, trainerId) {
  const rows = await sql`
    SELECT a.id, a.guild_id, g.name AS guild_name, a.message, a.created_at
    FROM guild_applications a JOIN guilds g ON g.id = a.guild_id
    WHERE a.trainer_id = ${trainerId}
    ORDER BY a.created_at`;
  return rows.map((r) => ({
    id: Number(r.id), guildId: Number(r.guild_id), guildName: r.guild_name,
    message: r.message, createdAt: r.created_at,
  }));
}
