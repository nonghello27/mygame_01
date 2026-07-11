// SQL for a trainer's inventory (Phase 7.1): item stacks, owned equipment
// (bag + equipped), and owned runes. Grants and consumes are single atomic
// statements — same "claim, exactly once" shape as activities/matches — so
// concurrent callers can never double-grant or over-consume a stack.

/** Does this item def exist? (checked before granting, so a bad defId is a
 *  clean 404 instead of a raw FK-violation error.) `sell_gold` rides along
 *  (Phase 8) for the sell-to-system/marketplace-list flows that also call
 *  this — harmless for grant(), which never reads it. */
export async function getItemDef(sql, defId) {
  const rows = await sql`SELECT id, kind, name, sell_gold FROM item_defs WHERE id = ${defId}`;
  return rows[0] || null;
}

/** Add qty to a trainer's stack of one item def, creating the row if needed. */
export async function grantItem(sql, trainerId, defId, qty) {
  const rows = await sql`
    INSERT INTO items (trainer_id, def_id, qty)
    VALUES (${trainerId}, ${defId}, ${qty})
    ON CONFLICT (trainer_id, def_id) DO UPDATE SET qty = items.qty + EXCLUDED.qty
    RETURNING id, trainer_id, def_id, qty`;
  return rows[0];
}

/**
 * Spend qty from a trainer's stack — one UPDATE that only succeeds if enough
 * is on hand. No row back = insufficient (a 7.2 caller should read that as a
 * 409), and a concurrent caller can't double-spend the same stock.
 * @returns {Promise<object|null>} the updated stack row, or null if short.
 */
export async function consumeItem(sql, trainerId, defId, qty) {
  const rows = await sql`
    UPDATE items SET qty = qty - ${qty}
    WHERE trainer_id = ${trainerId} AND def_id = ${defId} AND qty >= ${qty}
    RETURNING id, trainer_id, def_id, qty`;
  return rows[0] || null;
}

/** Grant one piece of equipment to a trainer's bag (equipped_slot NULL). */
export async function grantEquipment(sql, trainerId, defId) {
  const rows = await sql`
    INSERT INTO trainer_equipment (trainer_id, def_id, enhance_level, equipped_slot)
    SELECT ${trainerId}, id, 0, NULL FROM equipment_defs WHERE id = ${defId}
    RETURNING id, trainer_id, def_id, enhance_level, equipped_slot`;
  return rows[0] || null;
}

/** Grant one monster-equipment piece to a trainer's bag (monster_id NULL). */
export async function grantMonsterEquipment(sql, trainerId, defId) {
  const rows = await sql`
    INSERT INTO monster_equipment (trainer_id, def_id, enhance_level, monster_id)
    SELECT ${trainerId}, id, 0, NULL FROM equipment_defs WHERE id = ${defId}
    RETURNING id, trainer_id, def_id, enhance_level, monster_id`;
  return rows[0] || null;
}

/** Look up an equipment def's domain, so the service can route the grant. */
export async function getEquipmentDomain(sql, defId) {
  const rows = await sql`SELECT domain FROM equipment_defs WHERE id = ${defId}`;
  return rows[0]?.domain ?? null;
}

/** Grant one rune to a trainer's bag, seeding charges_left from the def. */
export async function grantRune(sql, trainerId, defId) {
  const rows = await sql`
    INSERT INTO runes (trainer_id, def_id, level, charges_left, broken, monster_id)
    SELECT ${trainerId}, id, 1, max_charges, false, NULL FROM rune_defs WHERE id = ${defId}
    RETURNING id, trainer_id, def_id, level, charges_left, broken, monster_id`;
  return rows[0] || null;
}

/** Everything the inventory screen needs: stacks, owned equipment, runes.
 *  Each row carries its def's `sell_gold` (Phase 8) -> `sellGold` so the 🎒
 *  Inventory panel's Sell buttons (Round 4) can label their price without a
 *  second round trip; 0 means "not sellable to the system". */
export async function listInventory(sql, trainerId) {
  const [items, trainerEquip, monsterEquip, runes] = await Promise.all([
    sql`
      SELECT i.def_id, i.qty, d.kind, d.name, d.description, d.icon, d.sell_gold
      FROM items i JOIN item_defs d ON d.id = i.def_id
      WHERE i.trainer_id = ${trainerId} AND i.qty > 0
      ORDER BY d.kind, d.id`,
    sql`
      SELECT e.id, e.def_id, e.enhance_level, e.equipped_slot,
        d.domain, d.slot, d.name, d.description, d.icon, d.effects, d.enhance, d.sell_gold
      FROM trainer_equipment e JOIN equipment_defs d ON d.id = e.def_id
      WHERE e.trainer_id = ${trainerId}
      ORDER BY e.id`,
    sql`
      SELECT m.id, m.def_id, m.enhance_level, m.monster_id,
        d.domain, d.slot, d.name, d.description, d.icon, d.effects, d.enhance, d.sell_gold
      FROM monster_equipment m JOIN equipment_defs d ON d.id = m.def_id
      WHERE m.trainer_id = ${trainerId}
      ORDER BY m.id`,
    sql`
      SELECT r.id, r.def_id, r.level, r.charges_left, r.broken, r.monster_id,
        d.name, d.description, d.icon, d.effects, d.max_charges, d.repair_gold, d.sell_gold
      FROM runes r JOIN rune_defs d ON d.id = r.def_id
      WHERE r.trainer_id = ${trainerId}
      ORDER BY r.id`,
  ]);

  return {
    items: items.map((r) => ({
      defId: r.def_id, qty: r.qty, kind: r.kind, name: r.name, description: r.description,
      icon: r.icon, sellGold: r.sell_gold,
    })),
    equipment: {
      trainer: trainerEquip.map((r) => ({
        id: Number(r.id), defId: r.def_id, enhanceLevel: r.enhance_level, equippedSlot: r.equipped_slot,
        domain: r.domain, slot: r.slot, name: r.name, description: r.description,
        icon: r.icon, effects: r.effects, enhance: r.enhance, sellGold: r.sell_gold,
      })),
      monster: monsterEquip.map((r) => ({
        id: Number(r.id), defId: r.def_id, enhanceLevel: r.enhance_level,
        monsterId: r.monster_id === null ? null : Number(r.monster_id),
        domain: r.domain, slot: r.slot, name: r.name, description: r.description,
        icon: r.icon, effects: r.effects, enhance: r.enhance, sellGold: r.sell_gold,
      })),
    },
    runes: runes.map((r) => ({
      id: Number(r.id), defId: r.def_id, level: r.level, chargesLeft: r.charges_left,
      broken: r.broken, monsterId: r.monster_id === null ? null : Number(r.monster_id),
      name: r.name, description: r.description, icon: r.icon, effects: r.effects,
      maxCharges: r.max_charges, repairGold: r.repair_gold, sellGold: r.sell_gold,
    })),
  };
}

// --- sell-to-system (Phase 8) --------------------------------------------------
//
// Instant, flat-price sale to the system (as opposed to the marketplace's
// player-to-player listings in server/repos/market.js). Same "guarded
// statement is the whole claim" shape: items are a guarded stack decrement
// (consumeItem, above); equipment/runes are a guarded DELETE (the enhance
// level does not change the price — it's the floor price) whose RETURNING
// row is exactly what a compensating restore needs if the credit leg loses a
// race afterward.

/**
 * Locate an owned equipment instance across BOTH domain tables — mirrors the
 * same "try trainer_equipment, then monster_equipment" lookup equip()/
 * enhance() do in server/repos/equipment.js, plus the def's `sell_gold`.
 */
export async function getOwnedEquipmentForSale(sql, trainerId, id) {
  const t = await sql`
    SELECT e.id, e.trainer_id, e.def_id, e.enhance_level, e.equipped_slot,
      d.sell_gold, 'trainer' AS domain
    FROM trainer_equipment e JOIN equipment_defs d ON d.id = e.def_id
    WHERE e.id = ${id} AND e.trainer_id = ${trainerId}`;
  if (t[0]) return t[0];
  const m = await sql`
    SELECT m.id, m.trainer_id, m.def_id, m.enhance_level, m.monster_id,
      d.sell_gold, 'monster' AS domain
    FROM monster_equipment m JOIN equipment_defs d ON d.id = m.def_id
    WHERE m.id = ${id} AND m.trainer_id = ${trainerId}`;
  return m[0] || null;
}

/** Guarded delete: trainer-domain equipment must be unequipped. Returns the
 *  deleted row (everything a compensating restore needs) or null on a lost
 *  claim (still equipped, wrong owner, or already gone). */
export async function deleteTrainerEquipmentForSale(sql, trainerId, id) {
  const rows = await sql`
    DELETE FROM trainer_equipment
    WHERE id = ${id} AND trainer_id = ${trainerId} AND equipped_slot IS NULL
    RETURNING id, trainer_id, def_id, enhance_level, equipped_slot`;
  return rows[0] || null;
}

/** Same shape as deleteTrainerEquipmentForSale, against monster_equipment. */
export async function deleteMonsterEquipmentForSale(sql, trainerId, id) {
  const rows = await sql`
    DELETE FROM monster_equipment
    WHERE id = ${id} AND trainer_id = ${trainerId} AND monster_id IS NULL
    RETURNING id, trainer_id, def_id, enhance_level, monster_id`;
  return rows[0] || null;
}

/** Compensation only: re-insert a deleted trainer-equipment row (from its own
 *  RETURNING) when the credit leg afterward fails — same "never leave a
 *  destructive claim half-finished" guarantee as every other claim-first
 *  flow in this codebase. Only reachable via a genuine failure between the
 *  delete and the credit (the credit itself, an unconditional wallet add,
 *  practically never fails on its own). */
export async function restoreTrainerEquipment(sql, row) {
  await sql`
    INSERT INTO trainer_equipment (id, trainer_id, def_id, enhance_level, equipped_slot)
    VALUES (${row.id}, ${row.trainer_id}, ${row.def_id}, ${row.enhance_level}, ${row.equipped_slot})`;
}

/** Same shape as restoreTrainerEquipment, against monster_equipment. */
export async function restoreMonsterEquipment(sql, row) {
  await sql`
    INSERT INTO monster_equipment (id, trainer_id, def_id, enhance_level, monster_id)
    VALUES (${row.id}, ${row.trainer_id}, ${row.def_id}, ${row.enhance_level}, ${row.monster_id})`;
}

/** One owned rune instance, joined with its def's sell_gold. */
export async function getRuneForSale(sql, trainerId, id) {
  const rows = await sql`
    SELECT r.id, r.trainer_id, r.def_id, r.level, r.charges_left, r.broken, r.monster_id, d.sell_gold
    FROM runes r JOIN rune_defs d ON d.id = r.def_id
    WHERE r.id = ${id} AND r.trainer_id = ${trainerId}`;
  return rows[0] || null;
}

/** Guarded delete: the rune must be unsocketed (broken runes ARE sellable —
 *  no `broken` check, only `monster_id IS NULL`, same allowance as the
 *  marketplace's rune escrow). */
export async function deleteRuneForSale(sql, trainerId, id) {
  const rows = await sql`
    DELETE FROM runes
    WHERE id = ${id} AND trainer_id = ${trainerId} AND monster_id IS NULL
    RETURNING id, trainer_id, def_id, level, charges_left, broken, monster_id`;
  return rows[0] || null;
}

/** Compensation only: re-insert a deleted rune row after a losing credit leg. */
export async function restoreRune(sql, row) {
  await sql`
    INSERT INTO runes (id, trainer_id, def_id, level, charges_left, broken, monster_id)
    VALUES (${row.id}, ${row.trainer_id}, ${row.def_id}, ${row.level}, ${row.charges_left}, ${row.broken}, ${row.monster_id})`;
}
