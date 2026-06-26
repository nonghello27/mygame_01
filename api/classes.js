// GET /api/classes -> { [cls]: { attackName, fx } }
// Same shape services/content.js#loadClasses used to return from data/classes.js.

import { db, sendJson } from "./_db.js";

export default async function handler(req, res) {
  try {
    const sql = db();
    const rows = await sql`SELECT cls, attack_name, fx FROM classes ORDER BY cls`;
    const out = {};
    for (const r of rows) out[r.cls] = { attackName: r.attack_name, fx: r.fx };
    sendJson(res, 200, out);
  } catch (e) {
    sendJson(res, 500, { error: String(e?.message || e) });
  }
}
