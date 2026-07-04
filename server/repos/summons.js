// SQL for the Summon Hall (Phase 7.4 step A): the enabled banner list a
// trainer can pull from, and the audit trail of past pulls. Only
// server/services/summon.js calls these — the rules (pay/refund, seed
// minting, refusing disabled banners) live there, the queries live here.

/** Banners the GET endpoint offers — disabled ones are never listed. */
export async function listEnabledSummonDefs(sql) {
  const rows = await sql`
    SELECT id, name, description, cost, pool
    FROM summon_defs WHERE enabled ORDER BY id`;
  return rows.map((r) => ({
    id: r.id, name: r.name, description: r.description, cost: r.cost, pool: r.pool,
  }));
}

/**
 * One banner's full detail, including `enabled` — performSummon() needs
 * that flag itself (a disabled banner 404s exactly like an unknown id, so a
 * retired banner never leaks that it once existed).
 */
export async function getSummonDef(sql, id) {
  const rows = await sql`
    SELECT id, name, description, cost, pool, enabled
    FROM summon_defs WHERE id = ${id}`;
  if (!rows[0]) return null;
  const r = rows[0];
  return { id: r.id, name: r.name, description: r.description, cost: r.cost, pool: r.pool, enabled: r.enabled };
}

/**
 * Write one pull's audit row: which banner, the cost/pool SNAPSHOT it
 * charged/offered at pull time, the seed rollSummon() used, and the result.
 * @returns {Promise<number>} the new audit row's id
 */
export async function insertSummon(sql, { trainerId, summonId, cost, pool, seed, resultSpeciesId, monsterId }) {
  const rows = await sql`
    INSERT INTO summons (trainer_id, summon_id, cost, pool, seed, result_species_id, monster_id)
    VALUES (${trainerId}, ${summonId}, ${JSON.stringify(cost)}::jsonb, ${JSON.stringify(pool)}::jsonb,
            ${seed}, ${resultSpeciesId}, ${monsterId})
    RETURNING id`;
  return Number(rows[0].id);
}
