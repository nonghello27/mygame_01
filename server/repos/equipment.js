// SQL for equipping/unequipping/enhancing owned gear (Phase 7.2). trainer_equipment
// and monster_equipment are separate tables with independent id sequences (see
// db/migrations/009_items.sql), so every function here is written against ONE
// explicit table — never a table name interpolated from the request body.
//
// Slot exclusivity (a monster/trainer holds at most one piece per def slot) is
// enforced by a single statement per equip call: a data-modifying CTE clears
// whatever piece currently occupies that slot (returning it to the bag) before
// the main UPDATE seats the new piece. Postgres guarantees a data-modifying
// WITH statement runs to completion exactly once even when its RETURNING rows
// are never read (https://www.postgresql.org/docs/current/queries-with.html),
// so "clear" always happens even though the main query never selects from it —
// and the two UPDATEs can't collide on the same row because "clear" explicitly
// excludes the piece being equipped (`me.id <> $eqId`).
//
// Enhancement (step B) is claim-first-then-pay, same family as
// activities.js's settleWork/settleTraining: `claimEnhance*` is ONE guarded
// UPDATE whose WHERE clause reads the CURRENT enhance_level (the exactly-once
// claim — a raced double-click's second request reads the same expectedLevel
// and loses), the CURRENT gold balance, and — when the piece costs a material
// — the CURRENT item stack, all inside the same statement so a concurrent
// spend can't slip between "checked" and "charged". Because the claim already
// preconditions funds/materials, the separate pay legs (debitGold /
// consumeItem) failing after a won claim is only reachable via a genuine
// concurrent-spend race (e.g. two enhances racing the same gold pile from
// different pieces); the service compensates by reverting the claimed level
// (and any already-paid leg) rather than leaving a free upgrade on the table.

/** The trainer's own-equipment instance (domain 'trainer'), joined with its def
 *  (including the def's enhance cost curve, needed by the enhance use-case). */
export async function getTrainerEquipmentInstance(sql, trainerId, equipmentId) {
  const rows = await sql`
    SELECT e.id, e.def_id, e.enhance_level, e.equipped_slot, d.domain, d.slot, d.enhance
    FROM trainer_equipment e JOIN equipment_defs d ON d.id = e.def_id
    WHERE e.id = ${equipmentId} AND e.trainer_id = ${trainerId}`;
  return rows[0] || null;
}

/** The trainer's monster-equipment instance (domain 'monster'), joined with its
 *  def (including the def's enhance cost curve). */
export async function getMonsterEquipmentInstance(sql, trainerId, equipmentId) {
  const rows = await sql`
    SELECT m.id, m.def_id, m.enhance_level, m.monster_id, d.domain, d.slot, d.enhance
    FROM monster_equipment m JOIN equipment_defs d ON d.id = m.def_id
    WHERE m.id = ${equipmentId} AND m.trainer_id = ${trainerId}`;
  return rows[0] || null;
}

/** Does this monster exist and belong to this trainer? (busy monsters count too.) */
export async function monsterOwnedByTrainer(sql, trainerId, monsterId) {
  const rows = await sql`SELECT id FROM monsters WHERE id = ${monsterId} AND trainer_id = ${trainerId}`;
  return rows.length > 0;
}

/**
 * Equip a piece of monster-domain equipment onto `monsterId`, in `slot`.
 * If that monster already has a different piece in the same def slot, it's
 * returned to the bag (monster_id -> NULL) as part of the SAME statement, so
 * there's no observable moment with two pieces in one slot. Moving a piece
 * from monster A to monster B is just this call again with the new monster —
 * no separate unequip step needed.
 */
export async function equipMonsterEquipment(sql, trainerId, equipmentId, monsterId, slot) {
  const rows = await sql`
    WITH cleared AS (
      UPDATE monster_equipment me
      SET monster_id = NULL
      FROM equipment_defs d
      WHERE d.id = me.def_id AND me.trainer_id = ${trainerId} AND me.monster_id = ${monsterId}
        AND d.slot = ${slot} AND me.id <> ${equipmentId}
    )
    UPDATE monster_equipment
    SET monster_id = ${monsterId}
    WHERE id = ${equipmentId} AND trainer_id = ${trainerId}
    RETURNING id, def_id, enhance_level, monster_id`;
  return rows[0] || null;
}

/** Return a monster-equipment piece to the bag. A no-op (not an error) if it's already there. */
export async function unequipMonsterEquipment(sql, trainerId, equipmentId) {
  const rows = await sql`
    UPDATE monster_equipment SET monster_id = NULL
    WHERE id = ${equipmentId} AND trainer_id = ${trainerId}
    RETURNING id, def_id, enhance_level, monster_id`;
  return rows[0] || null;
}

/**
 * Equip a piece of trainer-domain equipment into `slot` (the def's own slot —
 * caller passes it through, never trusts a client-picked slot). Same
 * clear-then-seat shape as equipMonsterEquipment, one def-slot per trainer.
 */
export async function equipTrainerEquipment(sql, trainerId, equipmentId, slot) {
  const rows = await sql`
    WITH cleared AS (
      UPDATE trainer_equipment e
      SET equipped_slot = NULL
      FROM equipment_defs d
      WHERE d.id = e.def_id AND e.trainer_id = ${trainerId} AND e.equipped_slot = ${slot}
        AND e.id <> ${equipmentId}
    )
    UPDATE trainer_equipment
    SET equipped_slot = ${slot}
    WHERE id = ${equipmentId} AND trainer_id = ${trainerId}
    RETURNING id, def_id, enhance_level, equipped_slot`;
  return rows[0] || null;
}

/** Return a trainer-equipment piece to the bag. A no-op (not an error) if it's already there. */
export async function unequipTrainerEquipment(sql, trainerId, equipmentId) {
  const rows = await sql`
    UPDATE trainer_equipment SET equipped_slot = NULL
    WHERE id = ${equipmentId} AND trainer_id = ${trainerId}
    RETURNING id, def_id, enhance_level, equipped_slot`;
  return rows[0] || null;
}

// --- enhancement (Phase 7.2, step B) ----------------------------------------

/**
 * Claim +1 enhance_level on a trainer-equipment piece. The WHERE clause is
 * the whole gate in one statement: right instance/owner, `enhance_level`
 * still matches what the caller read (the exactly-once claim), under the
 * curve's max, enough gold sitting on the trainer row, and — only when a
 * material is required — enough of that item stacked. When `material` is
 * null the `${itemId}::text IS NULL OR ...` clause is vacuously true, so
 * this is one function for both cost shapes rather than two near-duplicates.
 * @returns the updated row, or null if any precondition failed (the service
 * reads null as "enhance failed", a single 409).
 */
export async function claimEnhanceTrainerEquipment(
  sql, trainerId, equipmentId, expectedLevel, maxLevel, goldCost, material
) {
  const itemId = material?.itemId ?? null;
  const qty = material?.qtyPerLevel ?? 0;
  const rows = await sql`
    UPDATE trainer_equipment
    SET enhance_level = enhance_level + 1
    WHERE id = ${equipmentId} AND trainer_id = ${trainerId}
      AND enhance_level = ${expectedLevel} AND enhance_level < ${maxLevel}
      AND (SELECT gold FROM trainers WHERE id = ${trainerId}) >= ${goldCost}
      AND (${itemId}::text IS NULL OR EXISTS (
        SELECT 1 FROM items WHERE trainer_id = ${trainerId} AND def_id = ${itemId} AND qty >= ${qty}
      ))
    RETURNING id, def_id, enhance_level, equipped_slot`;
  return rows[0] || null;
}

/** Same shape as claimEnhanceTrainerEquipment, against monster_equipment. */
export async function claimEnhanceMonsterEquipment(
  sql, trainerId, equipmentId, expectedLevel, maxLevel, goldCost, material
) {
  const itemId = material?.itemId ?? null;
  const qty = material?.qtyPerLevel ?? 0;
  const rows = await sql`
    UPDATE monster_equipment
    SET enhance_level = enhance_level + 1
    WHERE id = ${equipmentId} AND trainer_id = ${trainerId}
      AND enhance_level = ${expectedLevel} AND enhance_level < ${maxLevel}
      AND (SELECT gold FROM trainers WHERE id = ${trainerId}) >= ${goldCost}
      AND (${itemId}::text IS NULL OR EXISTS (
        SELECT 1 FROM items WHERE trainer_id = ${trainerId} AND def_id = ${itemId} AND qty >= ${qty}
      ))
    RETURNING id, def_id, enhance_level, monster_id`;
  return rows[0] || null;
}

/**
 * Compensation only: undo a claimed +1 when a pay leg (debitGold/consumeItem)
 * fails after the claim already won. Guarded on `enhance_level = expectedLevel
 * + 1` so it can only revert the exact bump this call just made — never a
 * different concurrent enhance's.
 */
export async function revertEnhanceTrainerEquipment(sql, trainerId, equipmentId, expectedLevel) {
  const rows = await sql`
    UPDATE trainer_equipment SET enhance_level = enhance_level - 1
    WHERE id = ${equipmentId} AND trainer_id = ${trainerId} AND enhance_level = ${expectedLevel + 1}
    RETURNING id, def_id, enhance_level`;
  return rows[0] || null;
}

/** Same shape as revertEnhanceTrainerEquipment, against monster_equipment. */
export async function revertEnhanceMonsterEquipment(sql, trainerId, equipmentId, expectedLevel) {
  const rows = await sql`
    UPDATE monster_equipment SET enhance_level = enhance_level - 1
    WHERE id = ${equipmentId} AND trainer_id = ${trainerId} AND enhance_level = ${expectedLevel + 1}
    RETURNING id, def_id, enhance_level`;
  return rows[0] || null;
}

/** Spend gold from a trainer's balance — null (not a row) means insufficient. */
export async function debitGold(sql, trainerId, amount) {
  const rows = await sql`
    UPDATE trainers SET gold = gold - ${amount}
    WHERE id = ${trainerId} AND gold >= ${amount}
    RETURNING gold`;
  return rows[0] || null;
}

/** Compensation only: give gold back after a later pay leg fails. */
export async function refundGold(sql, trainerId, amount) {
  const rows = await sql`
    UPDATE trainers SET gold = gold + ${amount}
    WHERE id = ${trainerId}
    RETURNING gold`;
  return rows[0] || null;
}

// --- battle snapshot reads (Phase 7.2, step C) ------------------------------
//
// These two reads feed server/services/matches.js `toLane` and
// server/services/pvp.js `createPvpMatch` — the only places equipped gear is
// frozen into a match snapshot for the engine to see. Both already shape
// their rows into the lane/trainer-snapshot format the engine's battle_start
// equipment stage expects ({id, name, level, effects}): `level` is
// `enhance_level + 1` so the engine's existing `scaledFx` (bonus = perLevel *
// (level - 1)) yields exactly `perLevel * enhanceLevel` without any special
// casing for equipment vs. skills.

/**
 * Every equipped monster-domain piece for this trainer, across all of their
 * monsters, one row per piece — the caller groups by `monsterId` (a lane at
 * a time only knows its own monster). Unequipped pieces (monster_id IS NULL,
 * sitting in the bag) never reach a battle snapshot.
 */
export async function listEquippedMonsterEquipment(sql, trainerId) {
  const rows = await sql`
    SELECT m.monster_id, m.def_id, m.enhance_level, d.name, d.effects
    FROM monster_equipment m JOIN equipment_defs d ON d.id = m.def_id
    WHERE m.trainer_id = ${trainerId} AND m.monster_id IS NOT NULL`;
  return rows.map((r) => ({
    monsterId: Number(r.monster_id),
    id: r.def_id,
    name: r.name,
    level: Number(r.enhance_level) + 1,
    effects: r.effects,
  }));
}

/**
 * This trainer's equipped trainer-domain pieces (worn by the trainer, not a
 * monster) — a side-wide aura source, same as trainer skills. Unequipped
 * pieces (equipped_slot IS NULL) never reach a battle snapshot.
 */
export async function getTrainerEquipmentSnapshot(sql, trainerId) {
  const rows = await sql`
    SELECT e.def_id, e.enhance_level, d.name, d.effects
    FROM trainer_equipment e JOIN equipment_defs d ON d.id = e.def_id
    WHERE e.trainer_id = ${trainerId} AND e.equipped_slot IS NOT NULL`;
  return rows.map((r) => ({
    id: r.def_id,
    name: r.name,
    level: Number(r.enhance_level) + 1,
    effects: r.effects,
  }));
}
