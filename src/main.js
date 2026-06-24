// App entry point. Imports styles (Vite bundles them), initializes modules,
// and wires the control buttons. Page chrome that the battle engine shouldn't
// know about (the clash-zone status/winner) is handled here and passed in.

import "./styles/base.css";
import "./styles/board.css";
import "./styles/cutscene.css";

import { state, resetState } from "./core/state.js";
import { runBattle } from "./core/battle.js";
import { initBoard, renderBoard } from "./ui/board.js";
import { initLog, clearLog } from "./ui/log.js";
import { initCutscene } from "./cutscene/cutscene.js";

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

function onReset() {
  resetState();
  clearLog();
  vsBadge.style.display = "";
  vsBadge.classList.remove("pulse");
  setStatus("Front line: lane 1");
  startBtn.disabled = false;
  shuffleBtn.disabled = false;
  resetBtn.disabled = true;
  hint.style.display = "";
  renderBoard();
}

function onShuffle() {
  if (state.phase !== "setup") return;
  const b = state.armyB;
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  renderBoard();
}

function onCinematicToggle() {
  state.cinematic = !state.cinematic;
  cineBtn.textContent = "Cinematic: " + (state.cinematic ? "On" : "Off");
}

// --- boot ---
initBoard();
initLog();
initCutscene();
resetState();
renderBoard();

startBtn.addEventListener("click", onStart);
resetBtn.addEventListener("click", onReset);
shuffleBtn.addEventListener("click", onShuffle);
cineBtn.addEventListener("click", onCinematicToggle);
