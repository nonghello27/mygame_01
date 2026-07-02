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
    createdAt: row.created_at,
  };
}

/**
 * Find-or-create the trainer for a verified identity. Called on every login.
 * On conflict only the email is refreshed — the display name belongs to the
 * player once created (a future rename feature must not be undone by login).
 */
export async function upsertTrainer(sql, { provider, subject, name, email }) {
  const rows = await sql`
    INSERT INTO trainers (auth_provider, auth_subject, name, email)
    VALUES (${provider}, ${subject}, ${name}, ${email})
    ON CONFLICT (auth_provider, auth_subject)
    DO UPDATE SET email = EXCLUDED.email
    RETURNING id, name, email, exp, gold, expertise, created_at`;
  return shape(rows[0]);
}

export async function getTrainerById(sql, id) {
  const rows = await sql`
    SELECT id, name, email, exp, gold, expertise, created_at
    FROM trainers WHERE id = ${id}`;
  return shape(rows[0]);
}
