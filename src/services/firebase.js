// Firebase client bootstrap. Firebase handles the LOGIN UX only (which
// provider, popup flow, account linking); it is NOT the authority for who the
// player is in the game. After sign-in the client exchanges the Firebase ID
// token at POST /api/auth/login for our own server session cookie, and the
// server verifies that token against Google's public certs itself (server/auth.js).
//
// This config is public by design (it identifies the project; security comes
// from Firebase rules + our server-side token verification, not secrecy).

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDa5bBYbLBMXUfd9hwlLaOXc4vVV14z-Qo",
  authDomain: "mygame-01-web.firebaseapp.com",
  projectId: "mygame-01-web",
  storageBucket: "mygame-01-web.firebasestorage.app",
  messagingSenderId: "587935984638",
  appId: "1:587935984638:web:34a6ef63260d82fa6faeaf",
  measurementId: "G-SZK5S858MY",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Analytics only loads where it's supported (it throws in some browsers/
// environments, e.g. without cookies); never let telemetry block the game.
export async function initAnalytics() {
  try {
    const { getAnalytics, isSupported } = await import("firebase/analytics");
    if (await isSupported()) getAnalytics(app);
  } catch {
    /* analytics is best-effort */
  }
}

/** Google popup sign-in. @returns a Firebase ID token to exchange at the API. */
export async function signInWithGoogle() {
  const cred = await signInWithPopup(auth, new GoogleAuthProvider());
  return cred.user.getIdToken();
}

/** Forget the Firebase session (the server cookie is cleared separately). */
export function firebaseSignOut() {
  return signOut(auth).catch(() => {});
}
