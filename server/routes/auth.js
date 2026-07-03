// POST /api/auth/login
//   body: { credential }   (a Firebase ID token from the client SDK)
//   -> Set-Cookie session + { trainer }
//
// Verifies the Firebase token cryptographically, finds-or-creates the trainer
// for that identity (auto-created on first login, per the game design), and
// issues OUR HttpOnly session cookie — Firebase authenticates, the game
// session stays server-owned. The client never learns or sends a trainer id.
//
// POST /api/auth/logout -> clears the session cookie. Sessions are stateless
// (signed, not stored), so "logout" is simply the browser forgetting the token.

import { db } from "../db.js";
import { sendJson, readJson, httpError } from "../http.js";
import { verifyFirebaseToken, signSession, sessionSetCookie, sessionClearCookie } from "../auth.js";
import { upsertTrainer } from "../repos/trainers.js";
import { isAdminEmail } from "../services/admin.js";

export async function login(req, res) {
  try {
    const { credential } = await readJson(req);
    const identity = await verifyFirebaseToken(credential);
    const trainer = await upsertTrainer(db(), identity, isAdminEmail(identity.email));

    res.setHeader("Set-Cookie", sessionSetCookie(signSession(trainer.id)));
    sendJson(res, 200, { trainer });
  } catch (e) {
    // Any failure here reads as "not authenticated" — this endpoint has
    // always answered 401 (not 500) on error; keep that.
    throw httpError(401, String(e?.message || e));
  }
}

export async function logout(req, res) {
  res.setHeader("Set-Cookie", sessionClearCookie());
  sendJson(res, 200, { ok: true });
}
