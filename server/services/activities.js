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
  listJobDefs, getJobDef, insertActivity, listOpenActivities,
  dueActivities, settleWork, settleTraining,
} from "../repos/activities.js";
import { listMonstersByTrainer, claimMonsterForJob } from "../repos/monsters.js";

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
  return { settled, jobs, monsters, active };
}

/**
 * Assign a monster to a job. The busy lock is taken atomically in the repo
 * (owned + currently free, first caller wins) and the activity row shares the
 * exact busy_until timestamp so lock and timer can never drift apart.
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
  await insertActivity(sql, { trainerId, monsterId: id, jobId: job.id, endsAt });

  return farmState(sql, trainerId);
}
