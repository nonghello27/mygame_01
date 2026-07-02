// POST /api/auth/login
//   body: { credential }   (a Firebase ID token from the client SDK)
//   -> Set-Cookie session + { trainer }
//
// Verifies the Firebase token cryptographically, finds-or-creates the trainer
// for that identity (auto-created on first login, per the game design), and
// issues OUR HttpOnly session cookie — Firebase authenticates, the game
// session stays server-owned. The client never learns or sends a trainer id.

import { db, sendJson, readJson } from "../_db.js";
import { verifyFirebaseToken, signSession, sessionSetCookie } from "../../server/auth.js";
import { upsertTrainer } from "../../server/repos/trainers.js";
import { isAdminEmail } from "../../server/services/admin.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });

    const { credential } = await readJson(req);
    const identity = await verifyFirebaseToken(credential);
    const trainer = await upsertTrainer(db(), identity, isAdminEmail(identity.email));

    res.setHeader("Set-Cookie", sessionSetCookie(signSession(trainer.id)));
    sendJson(res, 200, { trainer });
  } catch (e) {
    sendJson(res, 401, { error: String(e?.message || e) });
  }
}
