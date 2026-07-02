// Server-only auth: Google credential verification + the session cookie.
// Imported by api/ handlers, never by src/ (client). The session token is a
// minimal HMAC-signed blob — payload.signature, both base64url — carrying only
// the trainer id and an expiry. trainer_id ALWAYS comes from this cookie;
// any handler that takes it from the request body instead is a bug (CLAUDE.md §1).

import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "bl_session";
const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set (see .env.example)");
  return s;
}

// --- Google ------------------------------------------------------------------

/**
 * Verify a Google Identity Services ID token and extract the identity.
 * Uses Google's tokeninfo endpoint: adequate for the prototype (Google checks
 * the signature/expiry; we check audience + issuer). If login volume ever
 * matters, switch to local JWKS verification to avoid the extra round-trip.
 * @returns {Promise<{provider:'google', subject:string, name:string, email:string|null}>}
 */
export async function verifyGoogleCredential(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set (see .env.example)");
  if (typeof credential !== "string" || !credential) throw new Error("missing credential");

  const r = await fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential)
  );
  if (!r.ok) throw new Error("Google rejected the credential");
  const t = await r.json();

  if (t.aud !== clientId) throw new Error("credential is for a different app");
  if (t.iss !== "https://accounts.google.com" && t.iss !== "accounts.google.com") {
    throw new Error("unexpected credential issuer");
  }
  return {
    provider: "google",
    subject: t.sub,
    name: t.name || (t.email ? t.email.split("@")[0] : "Trainer"),
    email: t.email ?? null,
  };
}

// --- session token -------------------------------------------------------------

/** Sign a session for a trainer id. `now` is injectable for tests. */
export function signSession(trainerId, ttlSeconds = SESSION_TTL_S, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ tid: trainerId, exp: Math.floor(now / 1000) + ttlSeconds })
  ).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** @returns {number|null} the trainer id, or null if missing/tampered/expired. */
export function verifySessionToken(token, now = Date.now()) {
  if (typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const expected = createHmac("sha256", secret()).update(payload).digest();
  const got = Buffer.from(token.slice(dot + 1), "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!Number.isInteger(data.tid) || data.tid <= 0) return null;
    if (typeof data.exp !== "number" || data.exp * 1000 < now) return null;
    return data.tid;
  } catch {
    return null;
  }
}

// --- cookie plumbing -----------------------------------------------------------

/** Read the trainer id from a request's session cookie (null when logged out). */
export function trainerIdFromRequest(req) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== COOKIE_NAME) continue;
    return verifySessionToken(decodeURIComponent(part.slice(eq + 1).trim()));
  }
  return null;
}

// `Secure` only in deployed environments: browsers drop Secure cookies on
// plain-http localhost, which would silently break `npm run dev` logins.
const secureFlag = () => (process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "");

/** Set-Cookie value that logs a trainer in. */
export function sessionSetCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_S}; HttpOnly; SameSite=Lax${secureFlag()}`;
}

/** Set-Cookie value that logs out. */
export function sessionClearCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureFlag()}`;
}
