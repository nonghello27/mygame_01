// POST /api/auth/logout -> clears the session cookie. Sessions are stateless
// (signed, not stored), so "logout" is simply the browser forgetting the token.

import { sendJson } from "../_db.js";
import { sessionClearCookie } from "../../server/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  res.setHeader("Set-Cookie", sessionClearCookie());
  sendJson(res, 200, { ok: true });
}
