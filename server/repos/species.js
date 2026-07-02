// SQL for the monster_species MASTER table (read-only at runtime; rows come
// from db/seed.mjs).

function shape(r) {
  return {
    id: r.id,
    name: r.name,
    cls: r.cls,
    emoji: r.emoji,
    hp: r.hp,
    atk: r.atk,
    spd: r.spd,
    sprite: r.sprite,
    starter: r.starter,
  };
}

export async function listSpecies(sql) {
  const rows = await sql`
    SELECT id, name, cls, emoji, hp, atk, spd, sprite, starter
    FROM monster_species ORDER BY id`;
  return rows.map(shape);
}

export async function listStarterSpecies(sql) {
  const rows = await sql`
    SELECT id, name, cls, emoji, hp, atk, spd, sprite, starter
    FROM monster_species WHERE starter ORDER BY id`;
  return rows.map(shape);
}
