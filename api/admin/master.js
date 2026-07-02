// GET /api/admin/master -> { classes, skills, species, jobs, enums }
//
// The admin console's single read: all four master tables with usage counts,
// plus the enum registries (elements, targeting rules, statuses, slot types)
// straight from shared/rules — the UI builds its dropdowns from these, so the
// form options can never drift from what the engine interprets. Admin only.

import { db, sendJson } from "../_db.js";
import { trainerIdFromRequest } from "../../server/auth.js";
import { requireAdmin, masterState } from "../../server/services/admin.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return sendJson(res, 405, { error: "GET only" });
    const sql = db();
    await requireAdmin(sql, trainerIdFromRequest(req));
    sendJson(res, 200, await masterState(sql));
  } catch (e) {
    sendJson(res, e.status || 500, { error: String(e?.message || e) });
  }
}
