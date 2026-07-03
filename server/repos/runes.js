// SQL for socketing/unsocketing owned runes (Phase 7.3, step A). Unlike
// equipment's slot exclusivity (one piece per def slot, enforced by a
// clear-then-seat CTE — see server/repos/equipment.js's header), a rune
// socket's capacity is a COUNT against the monster's species.rune_slots, not
// a 1-for-1 slot name. That count has to live INSIDE the same guarded UPDATE
// that seats the rune, or two concurrent socket calls could each read
// "count < capacity" as true before either commits and together overshoot
// it. So socketRune is one statement: the WHERE clause re-checks ownership,
// not-broken, AND (count of this monster's OTHER runes) < (its species'
// rune_slots) — all evaluated atomically by Postgres for the row the UPDATE
// is about to touch.
//
// Repair (step B) is claim-first-then-pay, same family as
// server/repos/equipment.js's claimEnhance*/revertEnhance*: claimRepair is
// ONE guarded UPDATE whose WHERE clause re-reads the CURRENT charges_left/
// broken state the caller already fetched (the exactly-once claim — a raced
// double-click's second request reads the same expected state and loses)
// and the CURRENT gold balance, all inside the same statement so a
// concurrent spend can't slip between "checked" and "charged". Because the
// claim already preconditions gold, debitGold (repos/trainers.js) failing
// after a won claim is only reachable via a genuine concurrent-spend race;
// the service compensates with revertRepair rather than leaving a free
// repair on the table. Repair doesn't touch monster_id — a socketed rune
// stays socketed through a repair.

/** A trainer's own rune instance, joined with its def (name/description for
 *  error messages, effects/max_charges/repair_gold for later steps). */
export async function getRuneInstance(sql, trainerId, runeId) {
  const rows = await sql`
    SELECT r.id, r.def_id, r.level, r.charges_left, r.broken, r.monster_id,
      d.name, d.effects, d.max_charges, d.repair_gold
    FROM runes r JOIN rune_defs d ON d.id = r.def_id
    WHERE r.id = ${runeId} AND r.trainer_id = ${trainerId}`;
  return rows[0] || null;
}

/**
 * Socket a rune onto `monsterId`. Guarded in one UPDATE so the capacity
 * check (other runes already on that monster vs. its species' rune_slots)
 * can't be raced by a concurrent socket call — see this file's header.
 * Moving a rune that's already socketed elsewhere straight to a new monster
 * is just this call again with the new monsterId; no separate unsocket step
 * needed (its own row is excluded from the "other runes" count via
 * `id <> ${runeId}`).
 * @returns the updated row, or null when the guard failed (rune isn't
 *   owned/broken, or the monster's slots are full — the service tells those
 *   apart by having already checked `broken` itself before calling this).
 */
export async function socketRune(sql, trainerId, runeId, monsterId) {
  const rows = await sql`
    UPDATE runes
    SET monster_id = ${monsterId}
    WHERE id = ${runeId} AND trainer_id = ${trainerId} AND broken = false
      AND (
        SELECT COUNT(*) FROM runes WHERE monster_id = ${monsterId} AND id <> ${runeId}
      ) < (
        SELECT s.rune_slots FROM monsters mo JOIN monster_species s ON s.id = mo.species_id
        WHERE mo.id = ${monsterId}
      )
    RETURNING id, def_id, level, charges_left, broken, monster_id`;
  return rows[0] || null;
}

/** Return a rune to the bag. A no-op (not an error) if it's already there —
 *  broken runes can be unsocketed too, they just can't be (re)socketed. */
export async function unsocketRune(sql, trainerId, runeId) {
  const rows = await sql`
    UPDATE runes SET monster_id = NULL
    WHERE id = ${runeId} AND trainer_id = ${trainerId}
    RETURNING id, def_id, level, charges_left, broken, monster_id`;
  return rows[0] || null;
}

// --- repair (Phase 7.3, step B) ---------------------------------------------

/**
 * Claim a full recharge: `charges_left -> maxCharges`, `broken -> false`.
 * The WHERE clause is the whole gate in one statement: right instance/owner,
 * `charges_left`/`broken` still match what the caller read (the
 * exactly-once claim), and enough gold sitting on the trainer row.
 * @returns the updated row, or null if any precondition failed (the service
 *   reads null as "repair failed", a single 409).
 */
export async function claimRepairRune(sql, trainerId, runeId, expectedCharges, expectedBroken, maxCharges, goldCost) {
  const rows = await sql`
    UPDATE runes
    SET charges_left = ${maxCharges}, broken = false
    WHERE id = ${runeId} AND trainer_id = ${trainerId}
      AND charges_left = ${expectedCharges} AND broken = ${expectedBroken}
      AND (SELECT gold FROM trainers WHERE id = ${trainerId}) >= ${goldCost}
    RETURNING id, def_id, level, charges_left, broken, monster_id`;
  return rows[0] || null;
}

/**
 * Compensation only: undo a claimed repair when the pay leg (debitGold)
 * fails after the claim already won. Guarded on the just-written full/
 * unbroken state so it can only revert the exact repair this call just
 * made — never a different concurrent repair's.
 */
export async function revertRepairRune(sql, trainerId, runeId, expectedCharges, expectedBroken, maxCharges) {
  const rows = await sql`
    UPDATE runes
    SET charges_left = ${expectedCharges}, broken = ${expectedBroken}
    WHERE id = ${runeId} AND trainer_id = ${trainerId}
      AND charges_left = ${maxCharges} AND broken = false
    RETURNING id, def_id, level, charges_left, broken, monster_id`;
  return rows[0] || null;
}

// --- battle snapshot reads + durability settlement (Phase 7.3, step C) -----
//
// listSocketedRunes feeds server/services/matches.js `toLane`/`groupByMonster`
// exactly like listEquippedMonsterEquipment does for equipment — same
// lane-shaped {monsterId, id, name, level, effects} contract, plus the
// engine-only `instanceId`/`chargesLeft` fields the runes stage/targeting
// override need to report consumption without ever writing DB state itself.

/**
 * Every socketed, unbroken rune for this trainer, across all of their
 * monsters, one row per rune — the caller groups by `monsterId` (a lane at a
 * time only knows its own monster). `broken = false` is belt-and-braces: a
 * broken rune is auto-unsocketed by durability settlement (applyRuneWear
 * below sets monster_id to NULL in the same statement that flips `broken`),
 * so this filter should rarely matter, but a rune broken by some other path
 * must never reach a battle snapshot.
 */
export async function listSocketedRunes(sql, trainerId) {
  const rows = await sql`
    SELECT r.monster_id, r.id, r.def_id, r.level, r.charges_left, d.name, d.effects
    FROM runes r JOIN rune_defs d ON d.id = r.def_id
    WHERE r.trainer_id = ${trainerId} AND r.monster_id IS NOT NULL AND r.broken = false`;
  return rows.map((r) => ({
    monsterId: Number(r.monster_id),
    instanceId: Number(r.id),
    id: r.def_id,
    name: r.name,
    level: r.level,
    chargesLeft: r.charges_left,
    effects: r.effects,
  }));
}

/**
 * Settle durability after a battle: for each `[instanceId, count]` entry in
 * the engine's reported tally, spend `count` charges off that rune instance
 * — one guarded UPDATE per id (the tally is tiny, so sequential statements
 * are fine; no need for a single multi-row statement). Breaking (charges hit
 * 0) and auto-unsocketing (monster_id -> NULL) happen in the SAME statement
 * as the decrement, so there's no observable moment of "broken but still
 * worn". Updates by id, not by any frozen snapshot state, so a rune that was
 * repaired or moved to a different monster since the match snapshot froze
 * still wears exactly as if it had sat still — and a rune deleted/reassigned
 * away entirely (no matching row) is silently skipped, per ROADMAP 7.3's
 * required tolerance for "the instance changed since the snapshot froze".
 */
export async function applyRuneWear(sql, trainerId, tally) {
  for (const [instanceId, count] of Object.entries(tally ?? {})) {
    const id = Number(instanceId);
    const n = Number(count);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(n) || n <= 0) continue;
    await sql`
      UPDATE runes
      SET charges_left = GREATEST(charges_left - ${n}, 0),
          broken = broken OR (charges_left - ${n} <= 0),
          monster_id = CASE WHEN charges_left - ${n} <= 0 THEN NULL ELSE monster_id END
      WHERE id = ${id} AND trainer_id = ${trainerId}`;
  }
}
