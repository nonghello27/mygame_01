// Activity use-cases: start a job, settle finished ones, describe the farm.
// This is the "lazy time" pillar made concrete (CLAUDE.md §1.5): no cron ever
// fires — settleActivities() runs at the top of every authenticated read
// (/api/me, /api/activities, match creation) and pays out whatever has
// finished since the player last looked.
//
// Server-authoritative as always: the client sends { monsterId, jobId } —
// two ids. Durations, rewards, and attribute gains come from job_defs rows;
// nothing in the request body is trusted as a value.

import { httpError } from "../http.js";
import {
  listJobDefs, getJobDef, insertActivityCapped, releaseMonsterLock,
  cancelActivity, listOpenActivities, dueActivities, settleWork, settleTraining,
} from "../repos/activities.js";
import { listMonstersByTrainer, claimMonsterForJob } from "../repos/monsters.js";

/**
 * A flat cap for now — "unlock more slots" is a later phase and will move
 * this to a per-trainer value; the client renders slots from the value the
 * server reports (farmState().farmSlots), never its own constant.
 */
export const MAX_FARM_SLOTS = 2;

/**
 * Pay out every finished, unresolved activity of this trainer. Each payout is
 * a single atomic claim+pay statement (repo), so concurrent reads settle each
 * activity exactly once — the loser of a race simply reports nothing.
 * @returns {Promise<object[]>} the outcomes settled by THIS call, for display.
 */
export async function settleActivities(sql, trainerId) {
  const settled = [];
  for (const a of await dueActivities(sql, trainerId)) {
    const outcome = { jobId: a.jobId, jobName: a.jobName, kind: a.kind, ...a.rewards };
    const won = a.kind === "work"
      ? await settleWork(sql, a.id, outcome, a.rewards)
      : await settleTraining(sql, a.id, outcome, a.rewards);
    if (won) settled.push({ monsterId: a.monsterId, ...outcome });
  }
  return settled;
}

/** Everything the farm screen needs, after settling what's due. */
export async function farmState(sql, trainerId) {
  const settled = await settleActivities(sql, trainerId);
  const [jobs, monsters, active] = await Promise.all([
    listJobDefs(sql),
    listMonstersByTrainer(sql, trainerId),
    listOpenActivities(sql, trainerId),
  ]);
  return { settled, jobs, monsters, active, farmSlots: MAX_FARM_SLOTS };
}

/**
 * Assign a monster to a job. The busy lock is taken atomically in the repo
 * (owned + currently free, first caller wins) and the activity row shares the
 * exact busy_until timestamp so lock and timer can never drift apart. The
 * activity INSERT itself is capped at MAX_FARM_SLOTS concurrent unresolved
 * rows (folded into the INSERT's own WHERE — a precheck-then-act pair here
 * would be a race bug, CLAUDE.md's workflow); when the insert loses the slot
 * race, the busy lock this call already won gets compensated (LIFO, the
 * performSummon precedent) before reporting 409.
 */
export async function startActivity(sql, trainerId, monsterId, jobId) {
  const id = Number(monsterId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "monsterId must be a monster's id");
  const job = await getJobDef(sql, String(jobId ?? ""));
  if (!job) throw httpError(400, "unknown job");

  // Free anything that finished first, so "was busy until a minute ago"
  // doesn't block a monster that has actually come home.
  await settleActivities(sql, trainerId);

  const endsAt = await claimMonsterForJob(sql, trainerId, id, job.durationS, job.kind);
  if (!endsAt) throw httpError(409, "that monster is not available — busy, or not yours");
  const inserted = await insertActivityCapped(
    sql, { trainerId, monsterId: id, jobId: job.id, endsAt }, MAX_FARM_SLOTS);
  if (!inserted) {
    await releaseMonsterLock(sql, trainerId, id, job.kind, endsAt);
    throw httpError(409, "no free farm slot — a running job must finish or be cancelled first");
  }

  return farmState(sql, trainerId);
}

/**
 * Cancel a still-running job early: no reward, the monster comes home
 * immediately. `settleActivities()` runs first so a job that has already
 * finished settles (and pays) rather than getting cancelled out from under
 * its own payout. A lost claim means there was nothing left to cancel.
 */
export async function cancelActivityById(sql, trainerId, activityId) {
  const id = Number(activityId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "activityId must be an activity's id");

  await settleActivities(sql, trainerId);

  const won = await cancelActivity(sql, trainerId, id);
  if (!won) throw httpError(409, "nothing to cancel — that job already finished or was cancelled");

  return farmState(sql, trainerId);
}
