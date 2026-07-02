// SQL for the monsters aggregate (INSTANCE rows owned by trainers). Display
// fields (name fallback, class, art) are joined in from the species master so
// callers get battle-ready objects.

function shape(r) {
  return {
    id: Number(r.id),
    speciesId: r.species_id,
    name: r.nickname ?? r.species_name,
    cls: r.cls,
    emoji: r.emoji,
    sprite: r.sprite,
    hp: r.hp,
    atk: r.atk,
    spd: r.spd,
  };
}

export async function listMonstersByTrainer(sql, trainerId) {
  const rows = await sql`
    SELECT m.id, m.species_id, m.nickname, m.hp, m.atk, m.spd,
           s.name AS species_name, s.cls, s.emoji, s.sprite
    FROM monsters m JOIN monster_species s ON s.id = m.species_id
    WHERE m.trainer_id = ${trainerId}
    ORDER BY m.id`;
  return rows.map(shape);
}

/**
 * Give a brand-new trainer one monster per starter species, stats copied
 * from the master baseline. Called lazily the first time a roster is needed.
 */
export async function grantStarters(sql, trainerId, starterSpecies) {
  for (const s of starterSpecies) {
    await sql`
      INSERT INTO monsters (trainer_id, species_id, hp, atk, spd)
      VALUES (${trainerId}, ${s.id}, ${s.hp}, ${s.atk}, ${s.spd})`;
  }
  return listMonstersByTrainer(sql, trainerId);
}
