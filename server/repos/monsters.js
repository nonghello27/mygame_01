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
  };
}
const shape = shapeMonster;

export async function listMonstersByTrainer(sql, trainerId) {
  const rows = await sql`
    SELECT m.id, m.species_id, m.nickname, m.hp, m.atk, m.spd,
           m.str, m.agi, m.vit, m.intl, m.dex, m.busy_until, m.busy_kind,
           s.name AS species_name, s.cls, s.emoji, s.sprite,
           s.element, s.attack_kind, s.attack_style, s.targeting,
           COALESCE(
             (SELECT json_agg(json_build_object(
                       'id', sk.id, 'name', sk.name, 'slot', sk.slot,
                       'cooldown', sk.cooldown, 'data', sk.data, 'level', ms.level)
                     ORDER BY ms.slot)
              FROM monster_skills ms JOIN skills sk ON sk.id = ms.skill_id
              WHERE ms.monster_id = m.id),
             '[]'::json) AS skills
    FROM monsters m JOIN monster_species s ON s.id = m.species_id
    WHERE m.trainer_id = ${trainerId}
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
    INSERT INTO monsters (trainer_id, species_id, hp, atk, spd, str, agi, vit, intl, dex)
    VALUES (${trainerId}, ${species.id}, ${species.base.hp}, ${species.base.atk}, ${species.base.spd},
            ${species.attrs.str}, ${species.attrs.agi}, ${species.attrs.vit}, ${species.attrs.int}, ${species.attrs.dex})
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
           m.str, m.agi, m.vit, m.intl, m.dex, m.busy_until, m.busy_kind,
           s.name AS species_name, s.cls, s.emoji, s.sprite,
           s.element, s.attack_kind, s.attack_style, s.targeting,
           COALESCE(
             (SELECT json_agg(json_build_object(
                       'id', sk.id, 'name', sk.name, 'slot', sk.slot,
                       'cooldown', sk.cooldown, 'data', sk.data, 'level', ms.level)
                     ORDER BY ms.slot)
              FROM monster_skills ms JOIN skills sk ON sk.id = ms.skill_id
              WHERE ms.monster_id = m.id),
             '[]'::json) AS skills
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
