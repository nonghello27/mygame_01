// Shared plumbing for the /api/admin/* endpoints (underscore = not routed).
// Every admin route has the same shape: authenticate the session, re-check
// is_admin in the DB (403 otherwise), run the mutation, respond with a FRESH
// masterState so the console just re-renders what the server now holds.

import { db, sendJson, readJson } from "../_db.js";
import { trainerIdFromRequest } from "../../server/auth.js";
import { requireAdmin, masterState } from "../../server/services/admin.js";

/**
 * Build a POST(upsert)/DELETE(remove) handler for one master table.
 * @param {(sql, body) => Promise<void>} save    validated upsert
 * @param {(sql, id) => Promise<void>}   remove  guarded delete
 * @param {string} idKey  body field naming the row on DELETE ('id' or 'cls')
 */
export function crudHandler(save, remove, idKey = "id") {
  return async function handler(req, res) {
    try {
      const sql = db();
      await requireAdmin(sql, trainerIdFromRequest(req));

      const body = await readJson(req);
      if (req.method === "POST") await save(sql, body);
      else if (req.method === "DELETE") await remove(sql, body[idKey]);
      else return sendJson(res, 405, { error: "POST or DELETE only" });

      sendJson(res, 200, await masterState(sql));
    } catch (e) {
      sendJson(res, e.status || 500, { error: String(e?.message || e) });
    }
  };
}
