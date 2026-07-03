// SQL for match sessions. A match row is the anti-tamper contract: created
// with server-chosen snapshots + seed, resolved exactly once.

/**
 * `kind`/`defenderId`/`attackerTrainer`/`defenderTrainer` default to the
 * free-match shape (kind='free', everything else null/absent), so a plain
 * free match is byte-for-byte the same INSERT it always was — PVP
 * (server/services/pvp.js createPvpMatch) is the only caller that fills them in.
 */
export async function insertMatch(sql, {
  id, attackerId, seed, attackerSnapshot, defenderSnapshot,
  kind = "free", defenderId = null, attackerTrainer = null, defenderTrainer = null,
}) {
  await sql`
    INSERT INTO matches (id, attacker_id, seed, attacker_snapshot, defender_snapshot,
                          kind, defender_id, attacker_trainer, defender_trainer)
    VALUES (${id}, ${attackerId}, ${seed},
            ${JSON.stringify(attackerSnapshot)}::jsonb,
            ${JSON.stringify(defenderSnapshot)}::jsonb,
            ${kind}, ${defenderId},
            ${attackerTrainer === null ? null : JSON.stringify(attackerTrainer)}::jsonb,
            ${defenderTrainer === null ? null : JSON.stringify(defenderTrainer)}::jsonb)`;
}

export async function getMatch(sql, id) {
  const rows = await sql`
    SELECT id, attacker_id, seed, attacker_snapshot, defender_snapshot, status,
           kind, defender_id, attacker_trainer, defender_trainer
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
    kind: r.kind,
    defenderId: r.defender_id === null ? null : Number(r.defender_id),
    attackerTrainer: r.attacker_trainer,
    defenderTrainer: r.defender_trainer,
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
