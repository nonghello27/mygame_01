// SQL for the monster_species MASTER table (read-only at runtime; rows come
// from db/seed.mjs). Skills are aggregated in so a species row is battle-ready.

function shape(r) {
  return {
    id: r.id,
    name: r.name,
    cls: r.cls,
    emoji: r.emoji,
    sprite: r.sprite,
    starter: r.starter,
    element: r.element,
    attackKind: r.attack_kind,
    attackStyle: r.attack_style,
    targeting: r.targeting,
    base: { hp: r.hp, atk: r.atk, spd: r.spd },
    attrs: { str: r.str, agi: r.agi, vit: r.vit, int: r.intl, dex: r.dex },
    skills: r.skills,
  };
}

export async function listSpecies(sql, starterOnly = false) {
  const rows = await sql`
    SELECT s.*,
      COALESCE(
        (SELECT json_agg(json_build_object(
                  'id', sk.id, 'name', sk.name, 'slot', sk.slot,
                  'cooldown', sk.cooldown, 'data', sk.data, 'level', 1)
                ORDER BY ss.slot)
         FROM species_skills ss JOIN skills sk ON sk.id = ss.skill_id
         WHERE ss.species_id = s.id),
        '[]'::json) AS skills
    FROM monster_species s
    WHERE s.starter OR NOT ${starterOnly}
    ORDER BY s.id`;
  return rows.map(shape);
}

export const listStarterSpecies = (sql) => listSpecies(sql, true);

/** One species by id (Phase 7.4: Summon Hall needs to mint a monster from
 *  whatever rollSummon() picked, without pulling the whole master list). */
export async function getSpeciesById(sql, id) {
  const rows = await sql`
    SELECT s.*,
      COALESCE(
        (SELECT json_agg(json_build_object(
                  'id', sk.id, 'name', sk.name, 'slot', sk.slot,
                  'cooldown', sk.cooldown, 'data', sk.data, 'level', 1)
                ORDER BY ss.slot)
         FROM species_skills ss JOIN skills sk ON sk.id = ss.skill_id
         WHERE ss.species_id = s.id),
        '[]'::json) AS skills
    FROM monster_species s
    WHERE s.id = ${id}`;
  return rows[0] ? shape(rows[0]) : null;
}
