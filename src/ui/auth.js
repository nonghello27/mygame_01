// Login gate + trainer profile bar. Blocks the game behind Google Sign-In
// when auth is configured; when VITE_GOOGLE_CLIENT_ID is absent (fresh clone,
// no Google project yet) it stays out of the way so the prototype still runs —
// per-player features just won't be available.

import { fetchMe, loginWithCredential, logout } from "../services/auth.js";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

let els = {};

export async function initAuth() {
  els = {
    gate: document.getElementById("authGate"),
    gateMsg: document.getElementById("authGateMsg"),
    gsiButton: document.getElementById("gsiButton"),
    profile: document.getElementById("profile"),
    name: document.getElementById("profileName"),
    gold: document.getElementById("profileGold"),
    exp: document.getElementById("profileExp"),
    logoutBtn: document.getElementById("logoutBtn"),
  };
  els.logoutBtn.addEventListener("click", async () => {
    await logout();
    location.reload();
  });

  const trainer = await fetchMe();
  if (trainer) return showProfile(trainer);

  if (!CLIENT_ID) {
    console.warn("VITE_GOOGLE_CLIENT_ID is not set — running without login (guest mode).");
    return;
  }
  await showGate();
}

/** Update the header bar; also called by later phases after gold/exp changes. */
export function showProfile(trainer) {
  els.gate.hidden = true;
  els.profile.hidden = false;
  els.name.textContent = trainer.name;
  els.gold.textContent = trainer.gold.toLocaleString();
  els.exp.textContent = trainer.exp.toLocaleString();
}

async function showGate() {
  els.gate.hidden = false;
  try {
    const gsi = await waitForGis();
    gsi.initialize({
      client_id: CLIENT_ID,
      callback: async ({ credential }) => {
        try {
          showProfile(await loginWithCredential(credential));
        } catch (e) {
          els.gateMsg.textContent = `Sign-in failed: ${e.message}`;
        }
      },
    });
    gsi.renderButton(els.gsiButton, { theme: "filled_black", size: "large", shape: "pill" });
  } catch (e) {
    els.gateMsg.textContent = e.message;
  }
}

/** The GIS <script> in index.html loads async; wait (bounded) for it. */
function waitForGis(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      const gsi = window.google?.accounts?.id;
      if (gsi) return resolve(gsi);
      if (Date.now() - t0 > timeoutMs) {
        return reject(new Error("Google Sign-In failed to load — check your network."));
      }
      setTimeout(poll, 50);
    })();
  });
}
