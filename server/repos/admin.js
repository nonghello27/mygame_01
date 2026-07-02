// SQL for the admin console (Phase 5): master-table CRUD + the usage counts
// that guard deletes. Only server/services/admin.js calls these — the rules
// (validation, 403/409 decisions) live there, the queries live here.
//
// Lists carry usage counts so the UI can show "in use by N" and the service
// can refuse deletes that would orphan instance rows.

// --- classes -------------------------------------------------------------------

export async function listClassesAdmin(sql) {
  const rows = await sql`
    SELECT c.cls, c.attack_name, c.fx,
      (SELECT count(*)::int FROM monster_species s WHERE s.cls = c.cls) AS species_count
    FROM classes c ORDER BY c.cls`;
  return rows.map((r) => ({
    cls: r.cls, attackName: r.attack_name, fx: r.fx, speciesCount: r.species_count,
  }));
}

export async function upsertClass(sql, { cls, attackName, fx }) {
  await sql`
    INSERT INTO classes (cls, attack_name, fx) VALUES (${cls}, ${attackName}, ${fx})
    ON CONFLICT (cls) DO UPDATE SET attack_name = EXCLUDED.attack_name, fx = EXCLUDED.fx`;
}

export async function classUsage(sql, cls) {
  const rows = await sql`SELECT count(*)::int AS n FROM monster_species WHERE cls = ${cls}`;
  return { species: rows[0].n };
}

export const deleteClass = (sql, cls) => sql`DELETE FROM classes WHERE cls = ${cls}`;

// --- skills --------------------------------------------------------------------

export async function listSkillsAdmin(sql) {
  const rows = await sql`
    SELECT k.id, k.name, k.slot, k.cooldown, k.data,
      (SELECT count(*)::int FROM species_skills ss WHERE ss.skill_id = k.id) AS species_uses,
      (SELECT count(*)::int FROM monster_skills ms WHERE ms.skill_id = k.id) AS monster_uses
    FROM skills k ORDER BY k.slot, k.id`;
  return rows.map((r) => ({
    id: r.id, name: r.name, slot: r.slot, cooldown: r.cooldown, data: r.data,
    speciesUses: r.species_uses, monsterUses: r.monster_uses,
  }));
}

export async function upsertSkill(sql, { id, name, slot, cooldown, data }) {
  await sql`
    INSERT INTO skills (id, name, slot, cooldown, data)
    VALUES (${id}, ${name}, ${slot}, ${cooldown}, ${JSON.stringify(data)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, slot = EXCLUDED.slot,
      cooldown = EXCLUDED.cooldown, data = EXCLUDED.data`;
}

export async function skillUsage(sql, id) {
  const rows = await sql`
    SELECT (SELECT count(*)::int FROM species_skills WHERE skill_id = ${id}) AS species,
           (SELECT count(*)::int FROM monster_skills WHERE skill_id = ${id}) AS monsters`;
  return { species: rows[0].species, monsters: rows[0].monsters };
}

export const deleteSkill = (sql, id) => sql`DELETE FROM skills WHERE id = ${id}`;

// --- species (+ its species_skills loadout) -------------------------------------

export async function listSpeciesAdmin(sql) {
  const rows = await sql`
    SELECT s.*,
      COALESCE((SELECT json_object_agg(ss.slot::text, ss.skill_id)
                FROM species_skills ss WHERE ss.species_id = s.id), '{}'::json) AS loadout,
      (SELECT count(*)::int FROM monsters m WHERE m.species_id = s.id) AS monster_count
    FROM monster_species s ORDER BY s.starter DESC, s.id`;
  return rows.map((r) => ({
    id: r.id, name: r.name, cls: r.cls, emoji: r.emoji, sprite: r.sprite,
    starter: r.starter, element: r.element, attackKind: r.attack_kind,
    attackStyle: r.attack_style, targeting: r.targeting,
    base: { hp: r.hp, atk: r.atk, spd: r.spd },
    attrs: { str: r.str, agi: r.agi, vit: r.vit, int: r.intl, dex: r.dex },
    // wire shape = validateSpecies shape: 4 slots, null = empty
    skills: [0, 1, 2, 3].map((slot) => r.loadout[String(slot)] ?? null),
    monsterCount: r.monster_count,
  }));
}

/** Upsert the species row, then replace its born-with loadout (seed.mjs style). */
export async function upsertSpecies(sql, s) {
  await sql`
    INSERT INTO monster_species
      (id, name, cls, emoji, hp, atk, spd, sprite, starter,
       element, attack_kind, attack_style, targeting, str, agi, vit, intl, dex)
    VALUES (${s.id}, ${s.name}, ${s.cls}, ${s.emoji}, ${s.base.hp}, ${s.base.atk},
            ${s.base.spd}, ${s.sprite}, ${s.starter}, ${s.element}, ${s.attackKind},
            ${s.attackStyle}, ${s.targeting}, ${s.attrs.str}, ${s.attrs.agi},
            ${s.attrs.vit}, ${s.attrs.int}, ${s.attrs.dex})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, cls = EXCLUDED.cls, emoji = EXCLUDED.emoji,
      hp = EXCLUDED.hp, atk = EXCLUDED.atk, spd = EXCLUDED.spd,
      sprite = EXCLUDED.sprite, starter = EXCLUDED.starter,
      element = EXCLUDED.element, attack_kind = EXCLUDED.attack_kind,
      attack_style = EXCLUDED.attack_style, targeting = EXCLUDED.targeting,
      str = EXCLUDED.str, agi = EXCLUDED.agi, vit = EXCLUDED.vit,
      intl = EXCLUDED.intl, dex = EXCLUDED.dex`;
  await sql`DELETE FROM species_skills WHERE species_id = ${s.id}`;
  for (let slot = 0; slot < s.skills.length; slot++) {
    if (!s.skills[slot]) continue;
    await sql`INSERT INTO species_skills (species_id, slot, skill_id)
              VALUES (${s.id}, ${slot}, ${s.skills[slot]})`;
  }
}

export async function speciesUsage(sql, id) {
  const rows = await sql`SELECT count(*)::int AS n FROM monsters WHERE species_id = ${id}`;
  return { monsters: rows[0].n };
}

export async function deleteSpecies(sql, id) {
  await sql`DELETE FROM species_skills WHERE species_id = ${id}`;
  await sql`DELETE FROM monster_species WHERE id = ${id}`;
}

// --- jobs ----------------------------------------------------------------------

export async function listJobsAdmin(sql) {
  const rows = await sql`
    SELECT j.id, j.kind, j.name, j.duration_s, j.rewards,
      (SELECT count(*)::int FROM activities a WHERE a.job_id = j.id) AS activity_count
    FROM job_defs j ORDER BY j.kind, j.duration_s`;
  return rows.map((r) => ({
    id: r.id, kind: r.kind, name: r.name, durationS: r.duration_s,
    rewards: r.rewards, activityCount: r.activity_count,
  }));
}

export async function upsertJob(sql, j) {
  await sql`
    INSERT INTO job_defs (id, kind, name, duration_s, rewards)
    VALUES (${j.id}, ${j.kind}, ${j.name}, ${j.durationS}, ${JSON.stringify(j.rewards)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      kind = EXCLUDED.kind, name = EXCLUDED.name,
      duration_s = EXCLUDED.duration_s, rewards = EXCLUDED.rewards`;
}

export async function jobUsage(sql, id) {
  const rows = await sql`SELECT count(*)::int AS n FROM activities WHERE job_id = ${id}`;
  return { activities: rows[0].n };
}

export const deleteJob = (sql, id) => sql`DELETE FROM job_defs WHERE id = ${id}`;
