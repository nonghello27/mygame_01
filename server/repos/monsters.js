// SQL for the monsters aggregate (INSTANCE rows owned by trainers). Traits
// that belong to the SPECIES (element, attack kind/style, targeting, art) are
// joined in; attributes and skills are the instance's own (they grow).

// Exported so other repos that join monsters+species (e.g. server/repos/pvp.js
// building a defense formation's battle lanes) shape rows identically instead
// of duplicating the mapping.
export function shapeMonster(r) {
  return {
    id: Number(r.id),
    speciesId: r.species_id,
    name: r.nickname ?? r.species_name,
    cls: r.cls,
    emoji: r.emoji,
    sprite: r.sprite,
    element: r.element,
    attackKind: r.attack_kind,
    attackStyle: r.attack_style,
    targeting: r.targeting,
    base: { hp: r.hp, atk: r.atk, spd: r.spd },
    attrs: { str: r.str, agi: r.agi, vit: r.vit, int: r.intl, dex: r.dex },
    busyUntil: r.busy_until ?? null,
    busyKind: r.busy_kind ?? null,
    skills: r.skills,
    rank: r.rank,
    equipmentCount: Number(r.equipment_count ?? 0),
    runeCount: Number(r.rune_count ?? 0),
    // Present only on rows selected WITH these subqueries (listMonstersByTrainer,
    // getMonsterById) — other shapeMonster() callers (e.g. server/repos/pvp.js)
    // select rows without them, so `?? []` keeps this shape safe everywhere.
    equipment: r.equipment ?? [],
    runes: r.runes ?? [],
  };
}
const shape = shapeMonster;

export async function listMonstersByTrainer(sql, trainerId) {
  const rows = await sql`
    SELECT m.id, m.species_id, m.nickname, m.hp, m.atk, m.spd,
           m.str, m.agi, m.vit, m.intl, m.dex, m.busy_until, m.busy_kind, m.rank,
           s.name AS species_name, s.cls, s.emoji, s.sprite,
           s.element, s.attack_kind, s.attack_style, s.targeting,
           COALESCE(
             (SELECT json_agg(json_build_object(
                       'id', sk.id, 'name', sk.name, 'slot', sk.slot,
                       'cooldown', sk.cooldown, 'data', sk.data, 'level', ms.level)
                     ORDER BY ms.slot)
              FROM monster_skills ms JOIN skills sk ON sk.id = ms.skill_id
              WHERE ms.monster_id = m.id),
             '[]'::json) AS skills,
           (SELECT count(*)::int FROM monster_equipment me WHERE me.monster_id = m.id) AS equipment_count,
           (SELECT count(*)::int FROM runes rn WHERE rn.monster_id = m.id) AS rune_count,
           COALESCE(
             (SELECT json_agg(json_build_object(
                       'id', me.def_id, 'name', ed.name,
                       'level', me.enhance_level + 1, 'effects', ed.effects))
              FROM monster_equipment me JOIN equipment_defs ed ON ed.id = me.def_id
              WHERE me.monster_id = m.id),
             '[]'::json) AS equipment,
           COALESCE(
             (SELECT json_agg(json_build_object(
                       'instanceId', rn.id, 'id', rn.def_id, 'name', rd.name,
                       'level', rn.level, 'chargesLeft', rn.charges_left, 'effects', rd.effects))
              FROM runes rn JOIN rune_defs rd ON rd.id = rn.def_id
              WHERE rn.monster_id = m.id),
             '[]'::json) AS runes
    FROM monsters m JOIN monster_species s ON s.id = m.species_id
    WHERE m.trainer_id = ${trainerId}
    ORDER BY m.id`;
  return rows.map(shape);
}

/**
 * Every "unassigned" (trainer_id IS NULL) monster instance — a monster
 * detached from an account (see 012_monster_release.sql) that still exists,
 * with its grown attributes and skills intact, but isn't on any roster.
 * Same SELECT shape as listMonstersByTrainer, just the WHERE flipped. Excludes
 * monsters escrowed in an OPEN marketplace listing (013_marketplace.sql,
 * Phase 8): a listed monster is also `trainer_id IS NULL` while it's for
 * sale, and must never surface here for an admin to Attach out from under
 * the listing — see isMonsterEscrowed()'s use in attachMonsterToTrainer.
 */
export async function listUnassignedMonsters(sql) {
  const rows = await sql`
    SELECT m.id, m.species_id, m.nickname, m.hp, m.atk, m.spd,
           m.str, m.agi, m.vit, m.intl, m.dex, m.busy_until, m.busy_kind, m.rank,
           s.name AS species_name, s.cls, s.emoji, s.sprite,
           s.element, s.attack_kind, s.attack_style, s.targeting,
           COALESCE(
             (SELECT json_agg(json_build_object(
                       'id', sk.id, 'name', sk.name, 'slot', sk.slot,
                       'cooldown', sk.cooldown, 'data', sk.data, 'level', ms.level)
                     ORDER BY ms.slot)
              FROM monster_skills ms JOIN skills sk ON sk.id = ms.skill_id
              WHERE ms.monster_id = m.id),
             '[]'::json) AS skills,
           (SELECT count(*)::int FROM monster_equipment me WHERE me.monster_id = m.id) AS equipment_count,
           (SELECT count(*)::int FROM runes rn WHERE rn.monster_id = m.id) AS rune_count
    FROM monsters m JOIN monster_species s ON s.id = m.species_id
    WHERE m.trainer_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM marketplace_listings ml
        WHERE ml.kind = 'monster' AND ml.ref_id = m.id AND ml.status = 'open'
      )
    ORDER BY m.id`;
  return rows.map(shape);
}

/**
 * Mint ONE new monster instance from a species master row: copies the base
 * statline, attributes, AND the species' born-with skill loadout — the exact
 * INSERT + species_skills copy grantStarters() has always done per species,
 * extracted so Phase 7.4's Summon Hall (server/services/summon.js) can mint
 * a single monster from a rollSummon() result without duplicating it.
 * @param {object} species a species row shaped like server/repos/species.js
 *   (id, base:{hp,atk,spd}, attrs:{str,agi,vit,int,dex})
 * @returns {Promise<number>} the new monster's id
 */
export async function mintMonster(sql, trainerId, species) {
  const rows = await sql`
    INSERT INTO monsters (trainer_id, species_id, hp, atk, spd, str, agi, vit, intl, dex, rank)
    VALUES (${trainerId}, ${species.id}, ${species.base.hp}, ${species.base.atk}, ${species.base.spd},
            ${species.attrs.str}, ${species.attrs.agi}, ${species.attrs.vit}, ${species.attrs.int}, ${species.attrs.dex},
            ${species.rank ?? "D"})
    RETURNING id`;
  const monsterId = Number(rows[0].id);
  await sql`
    INSERT INTO monster_skills (monster_id, slot, skill_id, level)
    SELECT ${monsterId}, slot, skill_id, 1 FROM species_skills
    WHERE species_id = ${species.id}`;
  return monsterId;
}

/**
 * Compensation only: undo a mintMonster() that turned out to be premature —
 * e.g. Phase 7.4's Summon Hall minted the monster but a LATER step in the
 * same pull failed, so the pull as a whole must not leave a free monster
 * behind. Same spirit as refundGold() in server/repos/trainers.js: never
 * called on the happy path, only to unwind a partially-completed action.
 * trainer_id is part of the WHERE so this can never delete another
 * trainer's monster even given a guessable id (same guard getMonsterById()
 * uses). Skills are deleted first to satisfy the monster_skills FK.
 */
export async function unmintMonster(sql, trainerId, monsterId) {
  await sql`DELETE FROM monster_skills WHERE monster_id = ${monsterId}`;
  await sql`DELETE FROM monsters WHERE id = ${monsterId} AND trainer_id = ${trainerId}`;
}

/**
 * Give a brand-new trainer one monster per starter species: base statline,
 * attributes, AND the species' born-with skill loadout, all copied from
 * master. Called lazily the first time a roster is needed.
 */
export async function grantStarters(sql, trainerId, starterSpecies) {
  for (const s of starterSpecies) {
    await mintMonster(sql, trainerId, s);
  }
  return listMonstersByTrainer(sql, trainerId);
}

/**
 * One shaped monster row by id (Phase 7.4: after minting a summon result,
 * the service needs to hand back that ONE monster in the same wire shape
 * listMonstersByTrainer() uses, without re-reading the whole roster).
 * trainer_id is part of the WHERE so this can never leak another trainer's
 * monster even given a guessable id.
 */
export async function getMonsterById(sql, trainerId, monsterId) {
  const rows = await sql`
    SELECT m.id, m.species_id, m.nickname, m.hp, m.atk, m.spd,
           m.str, m.agi, m.vit, m.intl, m.dex, m.busy_until, m.busy_kind, m.rank,
           s.name AS species_name, s.cls, s.emoji, s.sprite,
           s.element, s.attack_kind, s.attack_style, s.targeting,
           COALESCE(
             (SELECT json_agg(json_build_object(
                       'id', sk.id, 'name', sk.name, 'slot', sk.slot,
                       'cooldown', sk.cooldown, 'data', sk.data, 'level', ms.level)
                     ORDER BY ms.slot)
              FROM monster_skills ms JOIN skills sk ON sk.id = ms.skill_id
              WHERE ms.monster_id = m.id),
             '[]'::json) AS skills,
           (SELECT count(*)::int FROM monster_equipment me WHERE me.monster_id = m.id) AS equipment_count,
           (SELECT count(*)::int FROM runes rn WHERE rn.monster_id = m.id) AS rune_count,
           COALESCE(
             (SELECT json_agg(json_build_object(
                       'id', me.def_id, 'name', ed.name,
                       'level', me.enhance_level + 1, 'effects', ed.effects))
              FROM monster_equipment me JOIN equipment_defs ed ON ed.id = me.def_id
              WHERE me.monster_id = m.id),
             '[]'::json) AS equipment,
           COALESCE(
             (SELECT json_agg(json_build_object(
                       'instanceId', rn.id, 'id', rn.def_id, 'name', rd.name,
                       'level', rn.level, 'chargesLeft', rn.charges_left, 'effects', rd.effects))
              FROM runes rn JOIN rune_defs rd ON rd.id = rn.def_id
              WHERE rn.monster_id = m.id),
             '[]'::json) AS runes
    FROM monsters m JOIN monster_species s ON s.id = m.species_id
    WHERE m.id = ${monsterId} AND m.trainer_id = ${trainerId}`;
  return rows[0] ? shape(rows[0]) : null;
}

/**
 * Take the busy lock for a job — atomically, so two simultaneous requests
 * can't double-book: the WHERE only matches an owned, currently-free monster
 * and the first caller's UPDATE wins. Returns the busy_until timestamp the
 * activity row must share, or null when the claim failed (busy / not yours).
 */
export async function claimMonsterForJob(sql, trainerId, monsterId, durationS, kind) {
  const rows = await sql`
    UPDATE monsters
    SET busy_until = now() + make_interval(secs => ${durationS}), busy_kind = ${kind}
    WHERE id = ${monsterId} AND trainer_id = ${trainerId}
      AND (busy_until IS NULL OR busy_until <= now())
    RETURNING busy_until`;
  return rows[0]?.busy_until ?? null;
}

/**
 * Detach one owned monster from a trainer's account — sets trainer_id to
 * NULL, leaving the row (and its grown attributes/skills) intact as an
 * "unassigned" instance (012_monster_release.sql). ONE guarded UPDATE, same
 * claim shape as claimMonsterForJob: right owner, AND both of these hold —
 *   - not currently busy (a stale busy_until/busy_kind on a detached monster
 *     would be meaningless — nothing could ever clear it once it leaves the
 *     roster that started the job)
 *   - not a member of ANY formation_slots row (silently pulling a monster
 *     out of a trainer's saved PVP defense would leave that formation
 *     fighting with a hole in it while the trainer is offline)
 * Returns true when the claim won, false otherwise (busy, in a formation,
 * wrong owner, or unknown id — the service re-reads to tell those apart for
 * the error message).
 */
export async function detachMonster(sql, trainerId, monsterId) {
  const rows = await sql`
    UPDATE monsters
    SET trainer_id = NULL, busy_until = NULL, busy_kind = NULL
    WHERE id = ${monsterId} AND trainer_id = ${trainerId}
      AND (busy_until IS NULL OR busy_until <= now())
      AND NOT EXISTS (SELECT 1 FROM formation_slots fs WHERE fs.monster_id = monsters.id)
    RETURNING id`;
  return rows.length > 0;
}

/**
 * After a WON detach claim: return this monster's equipped gear/socketed
 * runes to its (former) trainer's bag. Gear rows keep their OWN trainer_id —
 * equipment/runes belong to the trainer who owns them, not the monster they
 * happen to be seated on — so detaching a monster never sends its gear out
 * of the account with it; it just falls back into the bag alongside every
 * other unequipped piece.
 */
export async function returnMonsterGearToBag(sql, monsterId) {
  await sql`UPDATE monster_equipment SET monster_id = NULL WHERE monster_id = ${monsterId}`;
  await sql`UPDATE runes SET monster_id = NULL WHERE monster_id = ${monsterId}`;
}

/**
 * Attach an unassigned (trainer_id IS NULL) monster to a trainer's account.
 * ONE guarded UPDATE — the WHERE's `trainer_id IS NULL` is the whole claim,
 * so two admins racing to attach the same orphan can't both win. Also
 * excludes a monster escrowed in an OPEN marketplace listing (Phase 8): that
 * monster is `trainer_id IS NULL` too while listed, but attaching it would
 * hijack a live listing out from under its seller. Returns true when the
 * claim won, false otherwise (already owned, escrowed, or unknown id — the
 * service tells those apart via isMonsterEscrowed for the 409 message).
 */
export async function attachMonster(sql, trainerId, monsterId) {
  const rows = await sql`
    UPDATE monsters SET trainer_id = ${trainerId}
    WHERE id = ${monsterId} AND trainer_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM marketplace_listings ml
        WHERE ml.kind = 'monster' AND ml.ref_id = monsters.id AND ml.status = 'open'
      )
    RETURNING id`;
  return rows.length > 0;
}

/**
 * Diagnostics only — never a gate. detachMonster()'s guarded UPDATE is the
 * one true claim; when it loses, the service re-reads this to turn "the
 * claim failed" into a helpful 409 (busy / in a formation / wrong owner /
 * unknown id), same spirit as equipment.js's claim-first-then-pay services
 * distinguishing gold-short from material-short after a lost claim.
 */
export async function getMonsterDetachDiagnostic(sql, monsterId) {
  const rows = await sql`
    SELECT m.trainer_id, m.busy_until, m.busy_kind,
           EXISTS (SELECT 1 FROM formation_slots fs WHERE fs.monster_id = m.id) AS in_formation
    FROM monsters m WHERE m.id = ${monsterId}`;
  return rows[0] || null;
}

/**
 * Is this unassigned monster currently escrowed in an OPEN marketplace
 * listing (Phase 8, 013_marketplace.sql)? Diagnostics only — attachMonster()'s
 * guarded UPDATE is the real gate (it already excludes escrowed monsters);
 * this is what turns a lost attach claim into a specific 409 instead of the
 * generic "already owned or does not exist".
 */
export async function isMonsterEscrowed(sql, monsterId) {
  const rows = await sql`
    SELECT 1 FROM marketplace_listings ml
    WHERE ml.kind = 'monster' AND ml.ref_id = ${monsterId} AND ml.status = 'open'`;
  return rows.length > 0;
}

/**
 * Admin-only (Phase 10.9): set one owned monster's rank directly — unlike
 * the species' rank (its baseline), an owned monster's rank lives its own
 * life from mint time on. ONE guarded UPDATE, same claim shape as
 * detachMonster/attachMonster: trainer_id is part of the WHERE so this can
 * never touch another trainer's monster even given a guessable id. Returns
 * true when the claim won, false when the id/owner pair didn't match (the
 * service turns that into a 404).
 */
export async function setMonsterRank(sql, trainerId, monsterId, rank) {
  const rows = await sql`
    UPDATE monsters SET rank = ${rank}
    WHERE id = ${monsterId} AND trainer_id = ${trainerId}
    RETURNING id`;
  return rows.length > 0;
}
