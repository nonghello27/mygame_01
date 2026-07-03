// SQL for trainer progression (Phase 6 step 3): expertise choice + trainer
// skill learn slots. `expertises` and `trainer_skill_defs` are master tables
// — src/data/expertises.js + `npm run db:seed` own their content, exactly
// like classes/skills/species/jobs; this repo only reads them.

function shapeSkillDef(r) {
  return { id: r.id, expertiseId: r.expertise_id, name: r.name, data: r.data };
}

export async function listExpertises(sql) {
  const rows = await sql`SELECT id, name FROM expertises ORDER BY id`;
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export async function listTrainerSkillDefs(sql) {
  const rows = await sql`
    SELECT id, expertise_id, name, data FROM trainer_skill_defs ORDER BY expertise_id, id`;
  return rows.map(shapeSkillDef);
}

export async function listTrainerSkills(sql, trainerId) {
  const rows = await sql`
    SELECT slot, skill_id, level FROM trainer_skills
    WHERE trainer_id = ${trainerId} ORDER BY slot`;
  return rows.map((r) => ({ slot: Number(r.slot), skillId: r.skill_id, level: Number(r.level) }));
}

/**
 * Set the trainer's expertise. Picking a NEW expertise wipes both learn
 * slots in the SAME statement (GAME_DESIGN §2 — deliberate cost); picking
 * the expertise already held is a no-op that wipes nothing, because the
 * inner UPDATE only matches (and the DELETE only sees a row via `changed`)
 * when the value actually differs.
 * @returns {Promise<boolean>} whether the expertise actually changed.
 */
export async function setExpertise(sql, trainerId, expertiseId) {
  const rows = await sql`
    WITH changed AS (
      UPDATE trainers SET expertise = ${expertiseId}
      WHERE id = ${trainerId} AND expertise IS DISTINCT FROM ${expertiseId}
      RETURNING id
    ), wiped AS (
      DELETE FROM trainer_skills WHERE trainer_id IN (SELECT id FROM changed)
      RETURNING trainer_id
    )
    SELECT id FROM changed`;
  return rows.length > 0;
}

/**
 * Learn (or replace) the skill in a slot. Level resets to 1 when the slot's
 * skill actually changes; re-setting the SAME skill keeps its level, so a
 * client resubmitting the current choice can't accidentally derank it.
 */
export async function upsertTrainerSkill(sql, trainerId, slot, skillId) {
  await sql`
    INSERT INTO trainer_skills (trainer_id, slot, skill_id, level)
    VALUES (${trainerId}, ${slot}, ${skillId}, 1)
    ON CONFLICT (trainer_id, slot) DO UPDATE SET
      skill_id = EXCLUDED.skill_id,
      level = CASE WHEN trainer_skills.skill_id = EXCLUDED.skill_id
                   THEN trainer_skills.level ELSE 1 END`;
}

export async function deleteTrainerSkill(sql, trainerId, slot) {
  await sql`DELETE FROM trainer_skills WHERE trainer_id = ${trainerId} AND slot = ${slot}`;
}
