// Server-only auth: Firebase ID-token verification + the session cookie.
// Imported by api/ handlers, never by src/ (client). Firebase is the identity
// PROVIDER (login UX, multiple providers later); the game session is OURS —
// a minimal HMAC-signed blob — payload.signature, both base64url — carrying
// only the trainer id and an expiry. trainer_id ALWAYS comes from this cookie;
// any handler that takes it from the request body instead is a bug (CLAUDE.md §1).

import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "node:crypto";

const COOKIE_NAME = "bl_session";
const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set (see .env.example)");
  return s;
}

// --- Firebase ID tokens --------------------------------------------------------

// Firebase ID tokens are RS256 JWTs signed by Google's securetoken service.
// We verify them locally against Google's published x509 certs (cached per
// their Cache-Control header) — no firebase-admin dependency, no extra
// network hop per login once the cert cache is warm.
const CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let certCache = { certs: null, expiresAt: 0 };

async function googleCerts(now = Date.now()) {
  if (certCache.certs && now < certCache.expiresAt) return certCache.certs;
  const r = await fetch(CERTS_URL);
  if (!r.ok) throw new Error("could not fetch Google signing certs");
  const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get("cache-control") || "")?.[1] ?? 3600);
  certCache = { certs: await r.json(), expiresAt: now + maxAge * 1000 };
  return certCache.certs;
}

const decodeJwtPart = (part) => {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString());
  } catch {
    throw new Error("missing or malformed credential");
  }
};

/**
 * Verify a Firebase ID token and extract the game identity. The subject is
 * the Firebase uid — stable for the account even if more providers (email,
 * Apple, ...) are linked to it later, so it's the right key for `trainers`.
 * @returns {Promise<{provider:'firebase', subject:string, name:string, email:string|null}>}
 */
export async function verifyFirebaseToken(idToken, now = Date.now()) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not set (see .env.example)");
  if (typeof idToken !== "string" || idToken.split(".").length !== 3) {
    throw new Error("missing or malformed credential");
  }

  const [h, p, s] = idToken.split(".");
  const header = decodeJwtPart(h);
  if (header.alg !== "RS256") throw new Error("unexpected token algorithm");

  const certPem = (await googleCerts(now))[header.kid];
  if (!certPem) throw new Error("unknown signing key");
  const ok = cryptoVerify(
    "RSA-SHA256",
    Buffer.from(`${h}.${p}`),
    createPublicKey(certPem),
    Buffer.from(s, "base64url")
  );
  if (!ok) throw new Error("invalid token signature");

  const t = decodeJwtPart(p);
  const nowS = Math.floor(now / 1000);
  if (typeof t.exp !== "number" || t.exp < nowS) throw new Error("credential expired");
  if (typeof t.iat !== "number" || t.iat > nowS + 300) throw new Error("credential from the future");
  if (t.aud !== projectId) throw new Error("credential is for a different app");
  if (t.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("unexpected credential issuer");
  if (typeof t.sub !== "string" || !t.sub) throw new Error("credential has no subject");

  return {
    provider: "firebase",
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
