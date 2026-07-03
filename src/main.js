// App entry point. Imports styles (Vite bundles them), initializes modules,
// and wires the control buttons. Page chrome that the battle engine shouldn't
// know about (the clash-zone status/winner) is handled here and passed in.

import "./styles/base.css";
import "./styles/board.css";
import "./styles/sprite.css";
import "./styles/cutscene.css";
import "./styles/auth.css";
import "./styles/farm.css";
import "./styles/admin.css";
import "./styles/pvp.css";
import "./styles/trainer.css";
import "./styles/inventory.css";

import { state, resetState, initContent, newMatch } from "./core/state.js";
import { runBattle } from "./core/battle.js";
import { initBoard, renderBoard } from "./ui/board.js";
import { initLog, clearLog, log } from "./ui/log.js";
import { initCutscene } from "./cutscene/cutscene.js";
import { initAuth } from "./ui/auth.js";
import { initFarm } from "./ui/farm.js";
import { initAdmin } from "./ui/admin.js";
import { initPvp } from "./ui/pvp.js";
import { initTrainer } from "./ui/trainer.js";
import { initInventory } from "./ui/inventory.js";

const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const cineBtn = document.getElementById("cineBtn");
const statusEl = document.getElementById("status");
const vsBadge = document.getElementById("vsBadge");
const hint = document.getElementById("hint");

// --- hooks the battle engine calls for page chrome ---
function setStatus(text) {
  statusEl.textContent = text;
}
function showWinner(youWin, survivor) {
  vsBadge.classList.remove("pulse");
  vsBadge.style.display = "none";
  statusEl.innerHTML = `<span class="winner" style="color:${youWin ? "var(--a)" : "var(--b)"}">${youWin ? "Victory" : "Defeat"}</span>`;
  resetBtn.disabled = false;
  void survivor; // available for future end-screen detail
}

// --- control handlers ---
async function onStart() {
  if (state.phase !== "setup") return;
  startBtn.disabled = true;
  shuffleBtn.disabled = true;
  resetBtn.disabled = true;
  hint.style.display = "none";
  vsBadge.classList.add("pulse");
  await runBattle({ setStatus, showWinner });
}

/** Back to setup. A finished match is spent (the server resolves each match
 *  exactly once), so after a battle this opens a fresh one; before a battle
 *  it just restores the current layout. */
function onReset() {
  return backToSetup(state.phase === "over" ? openMatch : resetState);
}

/** Ask the server for a fresh match: new opponent team, new frozen order. */
function onNewOpponent() {
  return backToSetup(openMatch);
}

/**
 * Open a PVP ladder match and return to the setup board — the exact same
 * plumbing as "New Opponent", just with mode:"pvp". Passed into the Arena
 * panel (ui/pvp.js) so its "Ranked Battle" button never has to fork a second
 * battle flow; on failure (e.g. no opponents yet) the error propagates so
 * the panel can show the server's message instead of the status line eating it.
 */
async function startRankedBattle() {
  await backToSetup(() => openMatch("pvp"), { rethrow: true });
  if (state.opponent) {
    log(`⚔ Ranked battle: vs ${state.opponent.name} (rating ${state.opponent.rating}).`, true);
  }
}

async function backToSetup(loader, { rethrow = false } = {}) {
  if (state.phase === "battle") return;
  shuffleBtn.disabled = true;
  try {
    await loader();
  } catch (e) {
    if (rethrow) throw e;
    return; // status line already explains; keep current board
  } finally {
    shuffleBtn.disabled = false;
  }
  clearLog();
  vsBadge.style.display = "";
  vsBadge.classList.remove("pulse");
  setStatus("Front line: lane 1");
  startBtn.disabled = false;
  resetBtn.disabled = true;
  hint.style.display = "";
  renderBoard();
}

/** Open a new match, surfacing server errors on the status line. */
async function openMatch(mode) {
  try {
    await newMatch(mode);
  } catch (e) {
    setStatus(`Could not start a match: ${e.message}`);
    throw e;
  }
}

function onCinematicToggle() {
  state.cinematic = !state.cinematic;
  cineBtn.textContent = "Cinematic: " + (state.cinematic ? "On" : "Off");
}

// --- boot ---
initBoard();
initLog();
initCutscene();
initFarm();
initAdmin();
initPvp(startRankedBattle);
initTrainer();
initInventory();
// The landing/login screen owns the start: once the session is confirmed it
// calls startSession(), which loads content and opens the first match.
initAuth(startSession);

async function startSession() {
  try {
    await initContent();
    await newMatch();
    renderBoard();
  } catch (e) {
    setStatus(`Could not load the game: ${e.message}`);
  }
}

startBtn.addEventListener("click", onStart);
resetBtn.addEventListener("click", onReset);
shuffleBtn.addEventListener("click", onNewOpponent);
cineBtn.addEventListener("click", onCinematicToggle);
