// GET /api/classes -> { [cls]: { attackName, fx } }
// Same shape services/content.js#loadClasses used to return from data/classes.js.

import { db } from "../db.js";
import { sendJson } from "../http.js";

export async function classes(req, res) {
  const sql = db();
  const rows = await sql`SELECT cls, attack_name, fx FROM classes ORDER BY cls`;
  const out = {};
  for (const r of rows) out[r.cls] = { attackName: r.attack_name, fx: r.fx };
  sendJson(res, 200, out);
}
