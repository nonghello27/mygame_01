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

import { state, resetState, initContent, newMatch, loadAdventureBattle } from "./core/state.js";
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
import { initAdventure, noteAdventureBattleResult } from "./ui/adventure.js";
import { initMarketplace } from "./ui/marketplace.js";
import { initTournament } from "./ui/tournament.js";
import { initGuild } from "./ui/guild.js";
import { initTeam, renderTeam, getPartyIds } from "./ui/team.js";
import { initMenubar } from "./ui/menubar.js";
import { registerView, showView } from "./ui/views.js";
import { surrenderAdventureBattle } from "./services/content.js";

const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const cineBtn = document.getElementById("cineBtn");
const surrenderBtn = document.getElementById("surrenderBtn");
const continueBtn = document.getElementById("continueBtn");
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

/**
 * Sync the battle-controls row to the board's current mode (Phase 10.14):
 * an Adventure fight (state.adventureBattle) hides Reset/New Opponent and
 * shows Surrender (only actionable before the battle starts); a normal
 * match is the mirror. Continue is always hidden here — it's revealed
 * explicitly by onStart()/the surrender handler once an adventure battle
 * actually ends.
 */
function updateBattleControls() {
  const adventureMode = !!state.adventureBattle;
  resetBtn.hidden = adventureMode;
  shuffleBtn.hidden = adventureMode;
  surrenderBtn.hidden = !adventureMode;
  surrenderBtn.disabled = state.phase !== "setup";
  continueBtn.hidden = true;
}

/** The board-reset chrome shared by backToSetup() (a normal match) and
 *  enterAdventureBattle() (a staged Adventure fight) once their loader has
 *  already populated state.armyA/B — clear the log, restore the VS badge,
 *  re-enable Start, and sync the controls row. Does NOT touch the Setup
 *  Team panel (renderTeam) — callers that want it call it themselves. */
function resetBoardChrome() {
  clearLog();
  vsBadge.style.display = "";
  vsBadge.classList.remove("pulse");
  setStatus(""); // clear any stale turn/error text; idle status shows nothing
  startBtn.disabled = false;
  resetBtn.disabled = true;
  hint.style.display = "";
  renderBoard();
  updateBattleControls();
}

// --- control handlers ---
async function onStart() {
  if (state.phase !== "setup") return;
  startBtn.disabled = true;
  shuffleBtn.disabled = true;
  resetBtn.disabled = true;
  surrenderBtn.disabled = true;
  hint.style.display = "none";
  vsBadge.classList.add("pulse");
  const result = await runBattle({ setStatus, showWinner });
  if (state.adventureBattle && state.phase === "over") {
    // An adventure fight ended (win or loss) — fold the fresh session back
    // into the Adventure panel and swap Surrender for Continue; the panel
    // itself re-renders once the player actually clicks through to it.
    noteAdventureBattleResult(result.adventure);
    const node = result.adventure.node;
    if (node.gold || node.exp) {
      log(`Won +${node.gold} gold, +${node.exp} exp — banked in the run's haul.`, true);
    }
    if (node.catch) {
      log(`You caught <b>${node.catch.name}</b>! It joins you when the run is complete.`, true);
    }
    if (node.stranded) {
      log("⏳ Out of moves — the party is stranded! Everything found this run is forfeited.", true);
    }
    surrenderBtn.hidden = true;
    continueBtn.hidden = false;
    continueBtn.disabled = false;
  }
}

/** Back to setup. A finished match is spent (the server resolves each match
 *  exactly once), so after a battle Reset opens a fresh match — since Phase
 *  10.4 against the SAME enemy (a rematch); "New Opponent" is the re-roll
 *  path. Before a battle it just restores the current layout. */
function onReset() {
  return backToSetup(state.phase === "over" ? () => openMatch(undefined, { keepEnemy: true }) : resetState);
}

/** Ask the server for a fresh match: new opponent team, new frozen order. */
function onNewOpponent() {
  return backToSetup(openMatch);
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
  try {
    await loader();
  } catch (e) {
    if (rethrow) throw e;
    return; // status line already explains; keep current board
  } finally {
    shuffleBtn.disabled = false;
  }
  resetBoardChrome();
  await renderTeam();
}

/**
 * Load a staged Adventure fight (Phase 10.14) onto the REAL battlefield and
 * switch to it — the same board-reset chrome backToSetup() applies after its
 * loader, minus renderTeam() (the party is the session's frozen one, not the
 * Setup Team panel's). Passed into the Adventure panel (ui/adventure.js) as
 * its `enterBattle` hook, the initPvp(startRankedBattle) precedent.
 * @param {object} pending the active session's `pendingBattle`.
 */
async function enterAdventureBattle(pending) {
  loadAdventureBattle(pending);
  resetBoardChrome();
  await showView("playground");
  log("⚔ A wild battle! Drag your lanes into order, then Start — Surrender ends the run in defeat.", true);
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
initAdventure({ enterBattle: enterAdventureBattle });
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
updateBattleControls(); // sync the controls row to the boot-time (normal-match) state
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
cineBtn.addEventListener("click", onCinematicToggle);
continueBtn.addEventListener("click", async () => {
  state.adventureBattle = null;
  continueBtn.hidden = true;
  updateBattleControls();
  await showView("adventure");
});
surrenderBtn.addEventListener("click", async () => {
  if (!(state.adventureBattle && state.phase === "setup")) return;
  if (!window.confirm("Surrender? The run ends in defeat and everything found so far is forfeited.")) return;
  surrenderBtn.disabled = true;
  try {
    const res = await surrenderAdventureBattle();
    noteAdventureBattleResult({ session: res.session, node: null });
    state.adventureBattle = null;
    updateBattleControls();
    await showView("adventure");
  } catch (e) {
    setStatus(e.message);
    surrenderBtn.disabled = false;
  }
});
