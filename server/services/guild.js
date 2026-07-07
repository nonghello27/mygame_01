// Guild use-cases (Phase 9.4): creation, membership, roles. The client
// contributes exactly one or two choices per call (a name/description/
// emblem at creation, a guildId to apply to, an applicationId to accept/
// reject, a trainerId to kick/promote/transfer) — EVERY write re-derives the
// caller's OWN role from `guild_members` via getMembership() first, never
// trusting a role from the request body (CLAUDE.md §1.1). Creation follows
// the exact claim-first-then-pay + LIFO-compensation shape
// server/services/summon.js's performSummon set: debit the gold cost, then
// insert the guild, then insert the founding member row — any failure from a
// given step onward undoes every earlier step, in reverse.
//
// Role invariants, enforced here (never in the DB alone, though the DB backs
// every one of them with a guarded statement in server/repos/guilds.js):
//   - one guild per trainer (guild_members.trainer_id UNIQUE — every join
//     path's own INSERT is the real guard; the pre-checks below exist only
//     for a clean error message, same "diagnostics vs. gate" split market.js
//     uses for its monster-listing blockers).
//   - a leader can never leave, be kicked, or be demoted directly — only a
//     successful transfer moves the role off them (server/repos/guilds.js's
//     claimLeave/claimKick/updateMemberRole all exclude `role = 'leader'`
//     from their WHERE).
//   - accept/kick/promote/reject/transfer are leader-only; a plain member
//     never even SEES the pending application queue (me()'s `applications`
//     key is present only for 'leader'/'officer' — CLAUDE.md §1.1, only what
//     the caller is entitled to see).

import { httpError } from "../http.js";
import {
  insertGuild, deleteGuildById, listGuildsWithCounts, getGuildById,
  getMembership, getMemberByGuildAndTrainer, listMembers, insertMember,
  claimLeave, claimKick, updateMemberRole, claimTransferLeadership,
  insertApplication, getApplicationById, deleteApplicationById, deleteApplicationsByTrainer,
  listApplicationsForGuild, listApplicationsByTrainer,
} from "../repos/guilds.js";
import { debitGold, refundGold } from "../repos/trainers.js";

export const GUILD_CREATE_COST = 500;

const NAME_MIN = 3;
const NAME_MAX = 24;
const DESCRIPTION_MAX = 200;
const EMBLEM_MAX = 8;
const DEFAULT_EMBLEM = "🏰";
const PROMOTABLE_ROLES = ["officer", "member"];

function validateName(name) {
  if (typeof name !== "string") throw httpError(400, "name is required");
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
    throw httpError(400, `name must be ${NAME_MIN}-${NAME_MAX} characters`);
  }
  return trimmed;
}

function validateDescription(description) {
  const d = description === undefined || description === null ? "" : String(description);
  if (d.length > DESCRIPTION_MAX) throw httpError(400, `description must be at most ${DESCRIPTION_MAX} characters`);
  return d;
}

function validateEmblem(emblem) {
  const e = emblem === undefined || emblem === null || emblem === "" ? DEFAULT_EMBLEM : String(emblem);
  if (e.length > EMBLEM_MAX) throw httpError(400, `emblem must be at most ${EMBLEM_MAX} characters`);
  return e;
}

function validateMessage(message) {
  const m = message === undefined || message === null ? "" : String(message);
  if (m.length > DESCRIPTION_MAX) throw httpError(400, `message must be at most ${DESCRIPTION_MAX} characters`);
  return m;
}

function requirePositiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw httpError(400, `${label} must be a positive integer`);
  return n;
}

// --- create / apply -----------------------------------------------------------

/**
 * Found a new guild: caller must be guildless (pre-check only — the real
 * race guard is insertMember's UNIQUE(trainer_id) 23505 below), pay the flat
 * gold cost, mint the guild row, then seat the founder as its leader. Any
 * failure from the gold debit onward undoes everything already won, in
 * reverse (LIFO): a taken name refunds the gold; a failed founding-member
 * insert deletes the just-created guild THEN refunds the gold.
 * @param {{name:string, description?:string, emblem?:string}} body
 */
export async function create(sql, trainerId, body) {
  const existing = await getMembership(sql, trainerId);
  if (existing) throw httpError(409, "you're already in a guild");

  const name = validateName(body?.name);
  const description = validateDescription(body?.description);
  const emblem = validateEmblem(body?.emblem);

  const debited = await debitGold(sql, trainerId, GUILD_CREATE_COST);
  if (!debited) throw httpError(409, "not enough gold");

  let guild;
  try {
    guild = await insertGuild(sql, { name, description, emblem, leaderId: trainerId });
  } catch (err) {
    await refundGold(sql, trainerId, GUILD_CREATE_COST);
    if (err.code === "23505") throw httpError(409, "guild name is taken");
    throw err;
  }

  try {
    await insertMember(sql, { guildId: guild.id, trainerId, role: "leader" });
  } catch (err) {
    // LIFO: undo the guild insert (the LATER win) before refunding the gold.
    await deleteGuildById(sql, guild.id);
    await refundGold(sql, trainerId, GUILD_CREATE_COST);
    // UNIQUE(trainer_id) on guild_members — the caller got accepted into
    // some OTHER guild in the gap between the guildless pre-check at the
    // top of this call and this insert. Same split as insertGuild's
    // name-taken handling just above.
    if (err.code === "23505") throw httpError(409, "you're already in a guild");
    throw err;
  }

  // Founding a guild moots any applications the caller had pending elsewhere.
  await deleteApplicationsByTrainer(sql, trainerId);

  return me(sql, trainerId);
}

/**
 * Apply to a guild: caller must be guildless; the target guild must exist.
 * UNIQUE(guild_id, trainer_id) is the real duplicate-application guard — a
 * race applying twice loses this INSERT as a 23505, turned into a 409 here.
 * @param {{guildId:number, message?:string}} body
 */
export async function apply(sql, trainerId, body) {
  const existing = await getMembership(sql, trainerId);
  if (existing) throw httpError(409, "you're already in a guild");

  const guildId = requirePositiveInt(body?.guildId, "guildId");
  const guild = await getGuildById(sql, guildId);
  if (!guild) throw httpError(404, "unknown guild");

  const message = validateMessage(body?.message);

  try {
    await insertApplication(sql, { guildId, trainerId, message });
  } catch (err) {
    if (err.code === "23505") throw httpError(409, "you already applied to this guild");
    throw err;
  }

  return me(sql, trainerId);
}

// --- leader actions: accept / reject / kick / promote / transfer -------------

/** Every leader-only action starts here: the caller's OWN membership,
 *  re-read from the DB, must show role 'leader' — never trusted otherwise. */
async function requireLeader(sql, trainerId) {
  const membership = await getMembership(sql, trainerId);
  if (!membership || membership.role !== "leader") throw httpError(403, "leader only");
  return membership;
}

/**
 * Accept a pending application. Order matters: insertMember (role 'member')
 * runs FIRST — its UNIQUE(trainer_id) 23505 means the applicant joined some
 * OTHER guild in the meantime, so the stale application is deleted and the
 * call 409s rather than seating a trainer twice. On success, every OTHER
 * pending application the newly-accepted trainer had (including this one) is
 * moot and cleaned up in one statement.
 * @param {{applicationId:number}} body
 */
export async function accept(sql, trainerId, body) {
  const leader = await requireLeader(sql, trainerId);
  const applicationId = requirePositiveInt(body?.applicationId, "applicationId");

  const application = await getApplicationById(sql, applicationId);
  if (!application || application.guildId !== leader.guildId) throw httpError(404, "unknown application");

  try {
    await insertMember(sql, { guildId: leader.guildId, trainerId: application.trainerId, role: "member" });
  } catch (err) {
    if (err.code === "23505") {
      await deleteApplicationById(sql, application.id, leader.guildId);
      throw httpError(409, "that trainer is already in a guild");
    }
    throw err;
  }

  await deleteApplicationsByTrainer(sql, application.trainerId);
  return me(sql, trainerId);
}

/**
 * Reject a pending application: the guarded DELETE (on the caller's own
 * guild) IS the claim itself — 404 covers both "no such application" and
 * "belongs to a different guild" indistinguishably (never leaking which).
 * @param {{applicationId:number}} body
 */
export async function reject(sql, trainerId, body) {
  const leader = await requireLeader(sql, trainerId);
  const applicationId = requirePositiveInt(body?.applicationId, "applicationId");

  const deleted = await deleteApplicationById(sql, applicationId, leader.guildId);
  if (!deleted) throw httpError(404, "unknown application");

  return me(sql, trainerId);
}

/**
 * Leave the caller's own guild. claimLeave's guarded DELETE excludes
 * `role = 'leader'` — a lost claim while the caller IS a member (confirmed
 * by the earlier getMembership() read) can only mean they're that guild's
 * leader, so the 409 is unambiguous: transfer leadership first. Disbanding a
 * guild entirely (a leaderless leave) is out of scope this phase.
 */
export async function leave(sql, trainerId) {
  const membership = await getMembership(sql, trainerId);
  if (!membership) throw httpError(409, "you're not in a guild");

  const claimed = await claimLeave(sql, trainerId);
  if (!claimed) throw httpError(409, "transfer leadership before leaving");

  return { left: true };
}

/**
 * Kick a member out of the caller's guild. claimKick's guarded DELETE
 * excludes `role = 'leader'`, so the leader (the only trainer who can even
 * reach this call) can never kick themself out — a self-kick attempt simply
 * loses the claim and reports the same 404 as kicking a stranger/ex-member.
 * @param {{trainerId:number}} body the target to remove
 */
export async function kick(sql, trainerId, body) {
  const leader = await requireLeader(sql, trainerId);
  const targetId = requirePositiveInt(body?.trainerId, "trainerId");

  const claimed = await claimKick(sql, leader.guildId, targetId);
  if (!claimed) throw httpError(404, "no such member to kick");

  return me(sql, trainerId);
}

/**
 * Promote/demote a member to 'officer' or 'member' — a closed set; 'leader'
 * is never reachable through this path (only transfer() moves that role).
 * updateMemberRole's guarded UPDATE also excludes `role = 'leader'`, so the
 * caller (guild leader) can't accidentally demote themself through here
 * either.
 * @param {{trainerId:number, role:'officer'|'member'}} body
 */
export async function promote(sql, trainerId, body) {
  const leader = await requireLeader(sql, trainerId);
  const targetId = requirePositiveInt(body?.trainerId, "trainerId");
  const role = body?.role;
  if (!PROMOTABLE_ROLES.includes(role)) throw httpError(400, `role must be one of: ${PROMOTABLE_ROLES.join(", ")}`);

  const claimed = await updateMemberRole(sql, leader.guildId, targetId, role);
  if (!claimed) throw httpError(404, "no such member");

  return me(sql, trainerId);
}

/**
 * Hand leadership to another member of the caller's own guild. The target
 * must already be a member of THIS guild (a diagnostic pre-check ONLY — the
 * real gate is claimTransferLeadership's own guilds.leader_id claim, which
 * re-checks membership itself so a target who leaves in the gap between
 * this read and that claim can't win it anyway). A lost claim/compensated
 * failure (null) covers two indistinguishable-by-design cases: a concurrent
 * transfer already moved leadership out from under this request, OR the
 * target left the guild in that same gap — either way nothing changed.
 * @param {{trainerId:number}} body the new leader
 */
export async function transfer(sql, trainerId, body) {
  const leader = await requireLeader(sql, trainerId);
  const targetId = requirePositiveInt(body?.trainerId, "trainerId");
  // Guard BEFORE the repo call: claimTransferLeadership's two follow-up role
  // UPDATEs run in sequence (new leader -> 'leader', then old leader ->
  // 'officer') and both target the SAME row when targetId === callerId,
  // which would leave the caller demoted to 'officer' with no 'leader' row
  // at all even though guilds.leader_id still (harmlessly) points at them.
  if (targetId === trainerId) throw httpError(400, "you're already the leader");

  const target = await getMemberByGuildAndTrainer(sql, leader.guildId, targetId);
  if (!target) throw httpError(404, "that trainer is not a member of your guild");

  const result = await claimTransferLeadership(sql, {
    guildId: leader.guildId, callerId: trainerId, newLeaderId: targetId,
  });
  if (!result) throw httpError(409, "target left or leadership already changed");

  return me(sql, trainerId);
}

// --- reads ---------------------------------------------------------------------

/** Every guild, for the browse list. */
export async function browse(sql) {
  return { guilds: await listGuildsWithCounts(sql) };
}

/**
 * The caller's whole guild view. Guildless: their own pending applications
 * (guild name + applied date) only. In a guild: the guild's public profile,
 * the caller's own role, and the full roster — PLUS the pending-application
 * queue, but ONLY when the caller is 'leader' or 'officer' (CLAUDE.md §1.1:
 * a plain member is never shown who else is waiting to join; only the
 * LEADER can act on the queue in this phase — officers see it read-only).
 */
export async function me(sql, trainerId) {
  const membership = await getMembership(sql, trainerId);
  if (!membership) {
    return { guild: null, myApplications: await listApplicationsByTrainer(sql, trainerId) };
  }

  const guild = await getGuildById(sql, membership.guildId);
  const members = await listMembers(sql, membership.guildId);
  const view = {
    guild: {
      id: guild.id, name: guild.name, description: guild.description,
      emblem: guild.emblem, createdAt: guild.createdAt,
    },
    myRole: membership.role,
    members,
  };
  if (membership.role === "leader" || membership.role === "officer") {
    view.applications = await listApplicationsForGuild(sql, membership.guildId);
  }
  return view;
}
