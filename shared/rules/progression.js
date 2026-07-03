// Trainer progression grammar (Phase 6 step 3): expertise choice + the 2
// trainer-skill learn slots (GAME_DESIGN §2). Pure — no DB, no I/O — so the
// client can import the constants to render "unlocks at N exp" without a
// round trip, and server/services/progression.js runs validateLearnChoice()
// against fresh DB state on every learn request (same split as
// server/services/adminValidate.js).

/** Trainer exp required before an expertise can be picked. */
export const EXPERTISE_UNLOCK_EXP = 10;

/** Fixed learn slots every trainer has, once an expertise is chosen. */
export const TRAINER_SKILL_SLOTS = 2;

/**
 * Validate a single "learn skillId into slot" choice against DB state.
 * Pure — returns null when the choice is OK, else a human-readable error.
 *
 * @param {{expertise: string|null}} trainer      the trainer row
 * @param {{id:string, expertiseId:string}[]} defs all trainer_skill_defs
 * @param {{slot:number, skillId:string}[]} slots  the trainer's CURRENT learned slots
 * @param {number} slot        requested slot, 0..TRAINER_SKILL_SLOTS-1
 * @param {string|null} skillId requested skill id, or null to clear the slot
 */
export function validateLearnChoice(trainer, defs, slots, slot, skillId) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= TRAINER_SKILL_SLOTS) {
    return `slot must be an integer in [0, ${TRAINER_SKILL_SLOTS})`;
  }
  if (skillId === null) return null; // clearing a slot is always valid slot-wise

  if (!trainer?.expertise) return "pick an expertise before learning a skill";

  const def = defs.find((d) => d.id === skillId);
  if (!def) return `unknown skill ${skillId}`;
  if (def.expertiseId !== trainer.expertise) {
    return `${skillId} is not a ${trainer.expertise} skill`;
  }

  const dup = slots.find((s) => s.slot !== slot && s.skillId === skillId);
  if (dup) return `${skillId} is already learned in slot ${dup.slot}`;

  return null;
}
