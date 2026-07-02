// Landing/login screen + trainer profile bar. Until the server confirms a
// session, only the auth screen is visible; the game (#app) stays hidden and
// appears the moment login succeeds. Firebase runs the sign-in UX — Google
// popup or email/password (register + reset) — and the resulting ID token is
// exchanged at /api/auth/login for the server's own session cookie; the game
// never trusts the client about who is playing.

import { fetchMe, loginWithCredential, logout } from "../services/auth.js";
import { setAdminVisible } from "./admin.js";
import {
  signInWithGoogle,
  signInWithEmail,
  registerWithEmail,
  resetPassword,
  firebaseSignOut,
  initAnalytics,
} from "../services/firebase.js";

let els = {};
let mode = "signin"; // "signin" | "register"
let onAuthed = () => {};

/** @param {() => void} authedCallback runs once the session is confirmed —
 *  main.js uses it to open the first match and unlock the board. */
export async function initAuth(authedCallback) {
  onAuthed = authedCallback || onAuthed;
  els = {
    app: document.getElementById("app"),
    screen: document.getElementById("authScreen"),
    msg: document.getElementById("authGateMsg"),
    googleBtn: document.getElementById("googleSignInBtn"),
    form: document.getElementById("emailForm"),
    name: document.getElementById("authName"),
    email: document.getElementById("authEmail"),
    password: document.getElementById("authPassword"),
    submitBtn: document.getElementById("emailSubmitBtn"),
    modeToggle: document.getElementById("modeToggle"),
    forgotBtn: document.getElementById("forgotBtn"),
    profile: document.getElementById("profile"),
    profileName: document.getElementById("profileName"),
    profileGold: document.getElementById("profileGold"),
    profileExp: document.getElementById("profileExp"),
    logoutBtn: document.getElementById("logoutBtn"),
  };

  els.googleBtn.addEventListener("click", () => attempt(signInWithGoogle));
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = els.email.value.trim();
    const pass = els.password.value;
    attempt(() =>
      mode === "register"
        ? registerWithEmail(els.name.value.trim(), email, pass)
        : signInWithEmail(email, pass)
    );
  });
  els.modeToggle.addEventListener("click", () => setMode(mode === "signin" ? "register" : "signin"));
  els.forgotBtn.addEventListener("click", onForgot);
  els.logoutBtn.addEventListener("click", async () => {
    await Promise.all([logout(), firebaseSignOut()]);
    location.reload();
  });

  initAnalytics(); // fire-and-forget; never blocks the game

  const trainer = await fetchMe();
  if (trainer) enterGame(trainer);
  else els.screen.hidden = false;
}

/** Run a Firebase flow that yields an ID token, then open the game session. */
async function attempt(getToken) {
  setMsg("");
  setBusy(true);
  try {
    const trainer = await loginWithCredential(await getToken());
    enterGame(trainer);
  } catch (e) {
    setMsg(friendlyError(e), true);
  } finally {
    setBusy(false);
  }
}

async function onForgot() {
  const email = els.email.value.trim();
  if (!email) return setMsg("Enter your email above first, then tap Forgot password.", true);
  try {
    await resetPassword(email);
    setMsg(`Password reset email sent to ${email}.`);
  } catch (e) {
    setMsg(friendlyError(e), true);
  }
}

function setMode(next) {
  mode = next;
  const register = mode === "register";
  els.name.hidden = !register;
  els.name.required = register;
  els.password.autocomplete = register ? "new-password" : "current-password";
  els.submitBtn.textContent = register ? "Create account" : "Sign in with Email";
  els.modeToggle.textContent = register
    ? "Already have an account? Sign in"
    : "New trainer? Create an account";
  els.forgotBtn.hidden = register;
  setMsg("");
}

function setBusy(busy) {
  for (const el of [els.googleBtn, els.submitBtn, els.modeToggle, els.forgotBtn]) {
    el.disabled = busy;
  }
}

function setMsg(text, isError = false) {
  els.msg.textContent = text;
  els.msg.classList.toggle("ok", !isError && !!text);
}

/** Map Firebase auth error codes to something a player can act on. */
function friendlyError(e) {
  switch (e?.code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in cancelled.";
    case "auth/invalid-email":
      return "That email address doesn't look valid.";
    case "auth/email-already-in-use":
      return "That email already has an account — try signing in instead.";
    case "auth/weak-password":
      return "Password is too weak — use at least 6 characters.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email or password is incorrect.";
    case "auth/too-many-requests":
      return "Too many attempts — wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network problem — check your connection and retry.";
    default:
      return `Sign-in failed: ${e?.message || e}`;
  }
}

/** Reveal the game, fill the header, and hand control to the game boot. */
function enterGame(trainer) {
  els.screen.hidden = true;
  els.app.hidden = false;
  showProfile(trainer);
  onAuthed();
}

/** Update the header bar; also called by later phases after gold/exp changes. */
export function showProfile(trainer) {
  els.profile.hidden = false;
  els.profileName.textContent = trainer.name;
  els.profileGold.textContent = trainer.gold.toLocaleString();
  els.profileExp.textContent = trainer.exp.toLocaleString();
  // The button is chrome only — every /api/admin request re-checks the flag.
  setAdminVisible(trainer.isAdmin === true);
}
