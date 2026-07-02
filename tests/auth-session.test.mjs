// Session-token tests for server/auth.js. Pure crypto — no DB, no network.
// The Google-credential path is deliberately untested here (it's a fetch to
// Google); its checks are audience + issuer, enforced in verifyGoogleCredential.

process.env.SESSION_SECRET = "test-secret-do-not-use-in-prod";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signSession,
  verifySessionToken,
  trainerIdFromRequest,
  sessionSetCookie,
} from "../server/auth.js";

test("sign → verify roundtrip returns the trainer id", () => {
  assert.equal(verifySessionToken(signSession(42)), 42);
});

test("expired tokens are rejected", () => {
  const t0 = Date.now();
  const token = signSession(7, 60, t0); // valid 60s from t0
  assert.equal(verifySessionToken(token, t0 + 59_000), 7);
  assert.equal(verifySessionToken(token, t0 + 61_000), null);
});

test("tampered payload or signature is rejected", () => {
  const token = signSession(1);
  const [payload, sig] = token.split(".");
  // Forge a payload claiming trainer 999, keep the old signature.
  const forged = Buffer.from(JSON.stringify({ tid: 999, exp: 9999999999 })).toString("base64url");
  assert.equal(verifySessionToken(`${forged}.${sig}`), null);
  // Corrupt the signature.
  const badSig = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  assert.equal(verifySessionToken(`${payload}.${badSig}`), null);
});

test("garbage tokens are rejected, not thrown", () => {
  for (const bad of [null, undefined, "", "abc", "a.b", "a.b.c", 123]) {
    assert.equal(verifySessionToken(bad), null);
  }
});

test("non-positive or non-integer trainer ids are rejected", () => {
  assert.equal(verifySessionToken(signSession(0)), null);
  assert.equal(verifySessionToken(signSession(-5)), null);
  assert.equal(verifySessionToken(signSession("1")), null);
});

test("trainerIdFromRequest reads the session out of the Cookie header", () => {
  const token = signSession(11);
  const cookie = sessionSetCookie(token).split(";")[0]; // "bl_session=<token>"
  assert.equal(trainerIdFromRequest({ headers: { cookie: `other=x; ${cookie}; more=y` } }), 11);
  assert.equal(trainerIdFromRequest({ headers: {} }), null);
  assert.equal(trainerIdFromRequest({ headers: { cookie: "bl_session=garbage" } }), null);
});
