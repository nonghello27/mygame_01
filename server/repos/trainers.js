// SQL for the trainers aggregate. Repos own the queries and the row→object
// shaping; services/handlers never write SQL for trainers anywhere else.

/** int8 columns arrive as strings from the driver; the API speaks numbers. */
function shape(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    exp: Number(row.exp),
    gold: Number(row.gold),
    expertise: row.expertise,
    isAdmin: row.is_admin === true,
    createdAt: row.created_at,
  };
}

/**
 * Find-or-create the trainer for a verified identity. Called on every login.
 * On conflict only the email is refreshed — the display name belongs to the
 * player once created (a future rename feature must not be undone by login).
 * `promoteAdmin` comes from the ADMIN_EMAILS env check at login; it can only
 * ever grant the flag (demotion is a manual UPDATE, so an env-var typo can't
 * lock every admin out).
 */
export async function upsertTrainer(sql, { provider, subject, name, email }, promoteAdmin = false) {
  const rows = await sql`
    INSERT INTO trainers (auth_provider, auth_subject, name, email, is_admin)
    VALUES (${provider}, ${subject}, ${name}, ${email}, ${promoteAdmin})
    ON CONFLICT (auth_provider, auth_subject)
    DO UPDATE SET email = EXCLUDED.email,
                  is_admin = trainers.is_admin OR EXCLUDED.is_admin
    RETURNING id, name, email, exp, gold, expertise, is_admin, created_at`;
  return shape(rows[0]);
}

export async function getTrainerById(sql, id) {
  const rows = await sql`
    SELECT id, name, email, exp, gold, expertise, is_admin, created_at
    FROM trainers WHERE id = ${id}`;
  return shape(rows[0]);
}

// --- wallet ops (moved from repos/equipment.js — generic trainer-gold ops
// that Phase 7.2's enhance() and Phase 7.3's repair() both need) -----------

/** Spend gold from a trainer's balance — null (not a row) means insufficient. */
export async function debitGold(sql, trainerId, amount) {
  const rows = await sql`
    UPDATE trainers SET gold = gold - ${amount}
    WHERE id = ${trainerId} AND gold >= ${amount}
    RETURNING gold`;
  return rows[0] || null;
}

/** Compensation only: give gold back after a later pay leg fails. */
export async function refundGold(sql, trainerId, amount) {
  const rows = await sql`
    UPDATE trainers SET gold = gold + ${amount}
    WHERE id = ${trainerId}
    RETURNING gold`;
  return rows[0] || null;
}

/**
 * Admin-only absolute set (Phase 10.1) — deliberately unlike debit/refund's
 * relative math: the admin states the balance. Null means no such trainer.
 */
export async function setGold(sql, trainerId, gold) {
  const rows = await sql`
    UPDATE trainers SET gold = ${gold}
    WHERE id = ${trainerId}
    RETURNING id, name, email, exp, gold, expertise, is_admin, created_at`;
  return shape(rows[0]);
}
