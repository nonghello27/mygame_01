// POST /api/auth/login
//   body: { credential }   (a Google Identity Services ID token)
//   -> Set-Cookie session + { trainer }
//
// Verifies the credential with Google, finds-or-creates the trainer for that
// identity (auto-created on first login, per the game design), and issues the
// HttpOnly session cookie. The client never learns or sends a trainer id —
// identity lives in the cookie only.

import { db, sendJson, readJson } from "../_db.js";
import { verifyGoogleCredential, signSession, sessionSetCookie } from "../../server/auth.js";
import { upsertTrainer } from "../../server/repos/trainers.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });

    const { credential } = await readJson(req);
    const identity = await verifyGoogleCredential(credential);
    const trainer = await upsertTrainer(db(), identity);

    res.setHeader("Set-Cookie", sessionSetCookie(signSession(trainer.id)));
    sendJson(res, 200, { trainer });
  } catch (e) {
    sendJson(res, 401, { error: String(e?.message || e) });
  }
}
