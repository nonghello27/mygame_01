// App entry point. Imports styles (Vite bundles them), initializes modules,
// and wires the control buttons. Page chrome that the battle engine shouldn't
// know about (the clash-zone status/winner) is handled here and passed in.

import "./styles/base.css";
import "./styles/board.css";
import "./styles/menu.css";
import "./styles/sprite.css";
import "./styles/cutscene.css";
import "./styles/auth.css";
import "./styles/farm.css";
import "./styles/admin.css";
import "./styles/pvp.css";
import "./styles/trainer.css";
import "./styles/inventory.css";
import "./styles/team.css";
import "./styles/monsterSetup.css";
import "./styles/summon.css";
import "./styles/adventure.css";
import "./styles/market.css";
import "./styles/tournament.css";
import "./styles/guild.css";

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
import { initMonsterSetup } from "./ui/monsterSetup.js";
import { initSummon } from "./ui/summon.js";
import { initAdventure } from "./ui/adventure.js";
import { initMarketplace } from "./ui/marketplace.js";
import { initTournament } from "./ui/tournament.js";
import { initGuild } from "./ui/guild.js";
import { initTeam, renderTeam, getPartyIds } from "./ui/team.js";
import { initMenubar } from "./ui/menubar.js";
import { registerView, showView } from "./ui/views.js";

const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const newEnemyBtn = document.getElementById("newEnemyBtn");
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
  newEnemyBtn.disabled = false;
  void survivor; // available for future end-screen detail
}

// --- control handlers ---
async function onStart() {
  if (state.phase !== "setup") return;
  startBtn.disabled = true;
  shuffleBtn.disabled = true;
  newEnemyBtn.disabled = true;
  resetBtn.disabled = true;
  hint.style.display = "none";
  vsBadge.classList.add("pulse");
  await runBattle({ setStatus, showWinner });
}

/** Back to setup. A finished match is spent (the server resolves each match
 *  exactly once), so after a battle Reset opens a fresh match — since Phase
 *  10.4 against the SAME enemy (a rematch); "New Opponent"/"New Enemy" are
 *  the re-roll paths. Before a battle it just restores the current layout. */
function onReset() {
  return backToSetup(state.phase === "over" ? () => openMatch(undefined, { keepEnemy: true }) : resetState);
}

/** Ask the server for a fresh match: new opponent team, new frozen order. */
function onNewOpponent() {
  return backToSetup(openMatch);
}

/** Re-roll ONLY the enemy (Phase 10.4): fresh match, no keepEnemyMatchId,
 *  but the CURRENT board lane order rides along as monsterIds so your team
 *  and arrangement carry over. Free matches always have owned monsterIds;
 *  a PVP board falls back to the remembered party (getPartyIds via openMatch). */
function onNewEnemy() {
  const ids = state.armyA.map((u) => u.monsterId);
  if (ids.every((id) => Number.isInteger(id))) {
    return backToSetup(() => newMatchKeepingTeam(ids));
  }
  return backToSetup(openMatch);
}

async function newMatchKeepingTeam(ids) {
  try {
    await newMatch(undefined, ids);
  } catch (e) {
    setStatus(`Could not start a match: ${e.message}`);
    throw e;
  }
}

/**
 * Open a PVP ladder match, return to the setup board, and switch to the
 * playground view (Phase 10.7) — the exact same plumbing as "New Opponent",
 * just with mode:"pvp". Passed into the Arena panel (ui/pvp.js) so its
 * "Ranked Battle" button never has to fork a second battle flow; on failure
 * (e.g. no opponents yet) the error propagates so the panel can show the
 * server's message instead of the status line eating it.
 */
async function startRankedBattle() {
  await backToSetup(() => openMatch("pvp"), { rethrow: true });
  await showView("playground");
  if (state.opponent) {
    log(`⚔ Ranked battle: vs ${state.opponent.name} (rating ${state.opponent.rating}).`, true);
  }
}

async function backToSetup(loader, { rethrow = false } = {}) {
  if (state.phase === "battle") return;
  shuffleBtn.disabled = true;
  newEnemyBtn.disabled = true;
  try {
    await loader();
  } catch (e) {
    if (rethrow) throw e;
    return; // status line already explains; keep current board
  } finally {
    shuffleBtn.disabled = false;
    newEnemyBtn.disabled = false;
  }
  clearLog();
  vsBadge.style.display = "";
  vsBadge.classList.remove("pulse");
  setStatus("Front line: lane 1");
  startBtn.disabled = false;
  resetBtn.disabled = true;
  hint.style.display = "";
  renderBoard();
  await renderTeam();
}

/** Open a new match, surfacing server errors on the status line. Reuses
 *  whatever party the Setup Team panel (ui/team.js) has remembered — null
 *  there means "server default" (Phase 10.2). `keepEnemy` (Phase 10.4)
 *  re-freezes the CURRENT free match's enemy into the new one — same
 *  opponent, new lineup; ignored when the board holds a PVP match
 *  (state.opponent) or no match. */
async function openMatch(mode, { keepEnemy = false } = {}) {
  const keepEnemyMatchId =
    keepEnemy && !state.opponent && state.matchId ? state.matchId : undefined;
  try {
    await newMatch(mode, getPartyIds() ?? undefined, keepEnemyMatchId);
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
initMenubar();
initBoard();
initLog();
initCutscene();
initFarm();
initAdmin();
initPvp(startRankedBattle);
initTrainer();
initInventory();
initMonsterSetup();
initSummon();
initAdventure();
initMarketplace();
initTournament();
initGuild();
initTeam({
  onSaveTeam: async () => {
    await backToSetup(() => openMatch(undefined, { keepEnemy: true }), { rethrow: true });
    await showView("playground");
  },
});
// The battlefield is always live — no onShow, since looking at it must never
// reset in-progress battle state.
registerView("playground", { button: document.getElementById("playgroundBtn"), el: document.getElementById("playgroundView") });
// The landing/login screen owns the start: once the session is confirmed it
// calls startSession(), which loads content and opens the first match.
initAuth(startSession);

async function startSession() {
  try {
    await initContent();
    await newMatch();
    renderBoard();
    await renderTeam();
  } catch (e) {
    setStatus(`Could not load the game: ${e.message}`);
  }
}

startBtn.addEventListener("click", onStart);
resetBtn.addEventListener("click", onReset);
shuffleBtn.addEventListener("click", onNewOpponent);
newEnemyBtn.addEventListener("click", onNewEnemy);
cineBtn.addEventListener("click", onCinematicToggle);
