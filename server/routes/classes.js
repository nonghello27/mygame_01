// GET /api/classes -> { [cls]: { attackName, fx, icon } }
// Same shape services/content.js#loadClasses used to return from data/classes.js.
// `icon` (Phase 10.12 follow-up) is the classes master table's icon column —
// null means "derive from the class name lowercased", same fallback
// src/ui/board.js's classIconEl() already applied.

import { db } from "../db.js";
import { sendJson } from "../http.js";

export async function classes(req, res) {
  const sql = db();
  const rows = await sql`SELECT cls, attack_name, fx, icon FROM classes ORDER BY cls`;
  const out = {};
  for (const r of rows) out[r.cls] = { attackName: r.attack_name, fx: r.fx, icon: r.icon };
  sendJson(res, 200, out);
}
