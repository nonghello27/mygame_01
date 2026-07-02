// SQL for the monsters aggregate (INSTANCE rows owned by trainers). Traits
// that belong to the SPECIES (element, attack kind/style, targeting, art) are
// joined in; attributes and skills are the instance's own (they grow).

function shape(r) {
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
 * Give a brand-new trainer one monster per starter species: base statline,
 * attributes, AND the species' born-with skill loadout, all copied from
 * master. Called lazily the first time a roster is needed.
 */
export async function grantStarters(sql, trainerId, starterSpecies) {
  for (const s of starterSpecies) {
    const rows = await sql`
      INSERT INTO monsters (trainer_id, species_id, hp, atk, spd, str, agi, vit, intl, dex)
      VALUES (${trainerId}, ${s.id}, ${s.base.hp}, ${s.base.atk}, ${s.base.spd},
              ${s.attrs.str}, ${s.attrs.agi}, ${s.attrs.vit}, ${s.attrs.int}, ${s.attrs.dex})
      RETURNING id`;
    await sql`
      INSERT INTO monster_skills (monster_id, slot, skill_id, level)
      SELECT ${rows[0].id}, slot, skill_id, 1 FROM species_skills
      WHERE species_id = ${s.id}`;
  }
  return listMonstersByTrainer(sql, trainerId);
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
