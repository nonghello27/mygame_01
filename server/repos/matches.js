// SQL for match sessions. A match row is the anti-tamper contract: created
// with server-chosen snapshots + seed, resolved exactly once.

export async function insertMatch(sql, { id, attackerId, seed, attackerSnapshot, defenderSnapshot }) {
  await sql`
    INSERT INTO matches (id, attacker_id, seed, attacker_snapshot, defender_snapshot)
    VALUES (${id}, ${attackerId}, ${seed},
            ${JSON.stringify(attackerSnapshot)}::jsonb,
            ${JSON.stringify(defenderSnapshot)}::jsonb)`;
}

export async function getMatch(sql, id) {
  const rows = await sql`
    SELECT id, attacker_id, seed, attacker_snapshot, defender_snapshot, status
    FROM matches WHERE id = ${id}`;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    attackerId: Number(r.attacker_id),
    seed: Number(r.seed),
    attackerSnapshot: r.attacker_snapshot,
    defenderSnapshot: r.defender_snapshot,
    status: r.status,
  };
}

/**
 * Atomically claim an open match and persist its result. Returns false when
 * the match was already resolved (the WHERE guard makes double-resolution —
 * a replayed request, a double click, a race — lose cleanly).
 */
export async function claimResolve(sql, id, result) {
  const rows = await sql`
    UPDATE matches
    SET status = 'resolved', result = ${JSON.stringify(result)}::jsonb, resolved_at = now()
    WHERE id = ${id} AND status = 'open'
    RETURNING id`;
  return rows.length > 0;
}
