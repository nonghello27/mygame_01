// SQL for the activities aggregate (work/training assignments) and the
// job_defs master table. The settlement statements are single atomic queries:
// a CTE claims the unresolved row (first caller wins, exactly like a match
// resolve) and the payout rides on that claim — a lost race pays nothing.

function shapeJob(r) {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    durationS: Number(r.duration_s),
    rewards: r.rewards,
  };
}

export async function listJobDefs(sql) {
  const rows = await sql`
    SELECT id, kind, name, duration_s, rewards FROM job_defs ORDER BY kind, duration_s`;
  return rows.map(shapeJob);
}

export async function getJobDef(sql, jobId) {
  const rows = await sql`
    SELECT id, kind, name, duration_s, rewards FROM job_defs WHERE id = ${jobId}`;
  return rows[0] ? shapeJob(rows[0]) : null;
}

export async function insertActivity(sql, { trainerId, monsterId, jobId, endsAt }) {
  await sql`
    INSERT INTO activities (trainer_id, monster_id, job_id, ends_at)
    VALUES (${trainerId}, ${monsterId}, ${jobId}, ${endsAt})`;
}

/** Unresolved assignments for the farm screen (running or awaiting collect). */
export async function listOpenActivities(sql, trainerId) {
  const rows = await sql`
    SELECT a.id, a.monster_id, a.job_id, a.started_at, a.ends_at, j.kind, j.name
    FROM activities a JOIN job_defs j ON j.id = a.job_id
    WHERE a.trainer_id = ${trainerId} AND NOT a.resolved
    ORDER BY a.ends_at`;
  return rows.map((r) => ({
    id: Number(r.id),
    monsterId: Number(r.monster_id),
    jobId: r.job_id,
    jobName: r.name,
    kind: r.kind,
    startedAt: r.started_at,
    endsAt: r.ends_at,
  }));
}

/** Unresolved AND finished — the rows lazy settlement has to pay out. */
export async function dueActivities(sql, trainerId) {
  const rows = await sql`
    SELECT a.id, a.monster_id, a.job_id, j.kind, j.name, j.rewards
    FROM activities a JOIN job_defs j ON j.id = a.job_id
    WHERE a.trainer_id = ${trainerId} AND NOT a.resolved AND a.ends_at <= now()
    ORDER BY a.ends_at`;
  return rows.map((r) => ({
    id: Number(r.id),
    monsterId: Number(r.monster_id),
    jobId: r.job_id,
    jobName: r.name,
    kind: r.kind,
    rewards: r.rewards,
  }));
}

/**
 * Settle a finished WORK activity: claim the row, free the monster, pay the
 * trainer — one statement, so a concurrent read can't double-pay. The busy
 * clear is guarded (only expired locks) so it can't wipe a lock a newer job
 * has already taken. @returns true if this call won the claim.
 */
export async function settleWork(sql, activityId, outcome, { gold, trainerExp }) {
  const rows = await sql`
    WITH claimed AS (
      UPDATE activities SET resolved = true, outcome = ${JSON.stringify(outcome)}::jsonb
      WHERE id = ${activityId} AND NOT resolved AND ends_at <= now()
      RETURNING trainer_id, monster_id
    ), freed AS (
      UPDATE monsters m SET busy_until = NULL, busy_kind = NULL
      FROM claimed c
      WHERE m.id = c.monster_id AND (m.busy_until IS NULL OR m.busy_until <= now())
    )
    UPDATE trainers t SET gold = t.gold + ${gold}, exp = t.exp + ${trainerExp}
    FROM claimed c WHERE t.id = c.trainer_id
    RETURNING t.id`;
  return rows.length > 0;
}

/**
 * Settle a finished TRAINING activity: claim the row, bake the attribute gain
 * into the monster, and free it — one statement. `attr` is matched inside SQL
 * (CASE) because column names can't be parameterized.
 */
export async function settleTraining(sql, activityId, outcome, { attr, gain }) {
  const rows = await sql`
    WITH claimed AS (
      UPDATE activities SET resolved = true, outcome = ${JSON.stringify(outcome)}::jsonb
      WHERE id = ${activityId} AND NOT resolved AND ends_at <= now()
      RETURNING monster_id
    )
    UPDATE monsters m SET
      busy_until = CASE WHEN m.busy_until > now() THEN m.busy_until ELSE NULL END,
      busy_kind  = CASE WHEN m.busy_until > now() THEN m.busy_kind  ELSE NULL END,
      str  = m.str  + CASE WHEN ${attr} = 'str' THEN ${gain} ELSE 0 END,
      agi  = m.agi  + CASE WHEN ${attr} = 'agi' THEN ${gain} ELSE 0 END,
      vit  = m.vit  + CASE WHEN ${attr} = 'vit' THEN ${gain} ELSE 0 END,
      intl = m.intl + CASE WHEN ${attr} = 'int' THEN ${gain} ELSE 0 END,
      dex  = m.dex  + CASE WHEN ${attr} = 'dex' THEN ${gain} ELSE 0 END
    FROM claimed c WHERE m.id = c.monster_id
    RETURNING m.id`;
  return rows.length > 0;
}
