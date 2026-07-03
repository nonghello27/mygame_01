// Trainer progression use-cases (Phase 6 step 3): read the expertise/skill
// picture, choose an expertise, learn a trainer skill into a slot.
//
// Server-authoritative as always: the client sends an expertiseId or a
// {slot, skillId} choice — nothing else. Every choice is checked against
// fresh DB state (validateLearnChoice, the same pure/impure split as
// adminValidate.js + server/services/admin.js).

import { httpError } from "../http.js";
import { EXPERTISE_UNLOCK_EXP, validateLearnChoice } from "../../shared/rules/progression.js";
import { getTrainerById } from "../repos/trainers.js";
import {
  listExpertises, listTrainerSkillDefs, listTrainerSkills,
  setExpertise, upsertTrainerSkill, deleteTrainerSkill,
} from "../repos/progression.js";

/** Everything the progression screen needs, in one call. */
export async function getProgression(sql, trainerId) {
  const trainer = await getTrainerById(sql, trainerId);
  if (!trainer) throw httpError(401, "unknown trainer");

  const [expertises, skillDefs, skills] = await Promise.all([
    listExpertises(sql),
    listTrainerSkillDefs(sql),
    listTrainerSkills(sql, trainerId),
  ]);

  return {
    expertises,
    skillDefs,
    skills,
    expertise: trainer.expertise,
    exp: trainer.exp,
    unlockExp: EXPERTISE_UNLOCK_EXP,
  };
}

/**
 * Pick (or switch) expertise. Switching wipes both learn slots — the repo
 * makes the update+wipe atomic, so no caller can ever observe a trainer
 * whose expertise and learned skills disagree.
 */
export async function chooseExpertise(sql, trainerId, expertiseId) {
  const trainer = await getTrainerById(sql, trainerId);
  if (!trainer) throw httpError(401, "unknown trainer");

  const expertises = await listExpertises(sql);
  if (!expertises.some((e) => e.id === expertiseId)) throw httpError(404, "no such expertise");
  if (trainer.exp < EXPERTISE_UNLOCK_EXP) {
    throw httpError(409, `expertise unlocks at ${EXPERTISE_UNLOCK_EXP} exp`);
  }

  await setExpertise(sql, trainerId, expertiseId); // no-op when already this expertise
  return getProgression(sql, trainerId);
}

/**
 * Learn (slot, skillId) or clear a slot (skillId === null). Re-validated
 * against fresh DB state every call — the client only ever sends a choice.
 */
export async function learnSkill(sql, trainerId, slot, skillId) {
  const trainer = await getTrainerById(sql, trainerId);
  if (!trainer) throw httpError(401, "unknown trainer");

  const [defs, slots] = await Promise.all([
    listTrainerSkillDefs(sql),
    listTrainerSkills(sql, trainerId),
  ]);

  const err = validateLearnChoice(trainer, defs, slots, slot, skillId);
  if (err) {
    const unknownSkill = skillId != null && !defs.some((d) => d.id === skillId);
    throw httpError(unknownSkill ? 404 : 400, err);
  }

  if (skillId === null) {
    await deleteTrainerSkill(sql, trainerId, slot);
  } else {
    await upsertTrainerSkill(sql, trainerId, slot, skillId);
  }
  return getProgression(sql, trainerId);
}
