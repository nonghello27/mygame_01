// Login gate + trainer profile bar. Firebase runs the sign-in UX (Google
// popup today; more providers are a Firebase-console toggle away). The
// resulting ID token is exchanged at /api/auth/login for the server's own
// session cookie — the game never trusts the client about who is playing.

import { fetchMe, loginWithCredential, logout } from "../services/auth.js";
import { signInWithGoogle, firebaseSignOut, initAnalytics } from "../services/firebase.js";

let els = {};

export async function initAuth() {
  els = {
    gate: document.getElementById("authGate"),
    gateMsg: document.getElementById("authGateMsg"),
    googleBtn: document.getElementById("googleSignInBtn"),
    profile: document.getElementById("profile"),
    name: document.getElementById("profileName"),
    gold: document.getElementById("profileGold"),
    exp: document.getElementById("profileExp"),
    logoutBtn: document.getElementById("logoutBtn"),
  };

  els.googleBtn.addEventListener("click", onGoogleSignIn);
  els.logoutBtn.addEventListener("click", async () => {
    await Promise.all([logout(), firebaseSignOut()]);
    location.reload();
  });

  initAnalytics(); // fire-and-forget; never blocks the game

  const trainer = await fetchMe();
  if (trainer) showProfile(trainer);
  else els.gate.hidden = false;
}

async function onGoogleSignIn() {
  els.gateMsg.textContent = "";
  els.googleBtn.disabled = true;
  try {
    const idToken = await signInWithGoogle();
    showProfile(await loginWithCredential(idToken));
  } catch (e) {
    // auth/popup-closed-by-user etc. — show something human, keep the button usable
    els.gateMsg.textContent =
      e?.code === "auth/popup-closed-by-user" ? "Sign-in cancelled." : `Sign-in failed: ${e.message}`;
  } finally {
    els.googleBtn.disabled = false;
  }
}

/** Update the header bar; also called by later phases after gold/exp changes. */
export function showProfile(trainer) {
  els.gate.hidden = true;
  els.profile.hidden = false;
  els.name.textContent = trainer.name;
  els.gold.textContent = trainer.gold.toLocaleString();
  els.exp.textContent = trainer.exp.toLocaleString();
}
