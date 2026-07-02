// The battle REPLAYER. The outcome is no longer computed here — the server
// (api/battle.js, via the shared/engine/resolve.js engine) resolves the whole
// fight from authoritative stats and returns an ordered event log. This module
// only animates that log: cutscenes, HP bars, the battle text, and shifting the
// lanes forward as units fall. A tampered client can therefore only lie to its
// own screen; it cannot change who actually won.
//
// UI-only concerns (status text, winner banner) are still injected as hooks so
// this module never reaches into page chrome directly.

import { state } from "./state.js";
import { requestBattle } from "../services/content.js";
import { sleep } from "../utils/helpers.js";
import { log, nameSpan } from "../ui/log.js";
import { renderBoard, cardEl, updateCardHp, floatDamage } from "../ui/board.js";
import { playCutscene } from "../cutscene/cutscene.js";

/**
 * Run a full battle to completion by asking the server to resolve it, then
 * replaying the returned events.
 * @param {{ setStatus:(t:string)=>void, showWinner:(youWin:boolean, survivor:object)=>void }} hooks
 */
export async function runBattle({ setStatus, showWinner }) {
  if (state.phase !== "setup") return;
  state.phase = "battle";
  renderBoard();
  log("Battle begins!", true);

  // The only thing the client decides is the lane ORDER of its own army;
  // the enemy's composition and order were frozen when the match was created.
  const playerOrder = state.armyA.map((u) => u.idx);

  let result;
  try {
    result = await requestBattle(state.matchId, playerOrder);
  } catch (e) {
    log(`Battle could not be resolved: ${e.message}`, true);
    setStatus("Connection error — try again");
    state.phase = "setup";
    return;
  }

  for (const ev of result.events) {
    if (ev.t === "duel") await replayDuel(ev, setStatus);
    else if (ev.t === "strike") await replayStrike(ev);
    else if (ev.t === "fall") await replayFall(ev);
  }

  const survivor = result.survivor ? unitByRef(result.survivor) : null;
  state.phase = "over";
  showWinner(result.youWin, survivor);
  if (survivor) {
    log(
      result.youWin
        ? `Your army wins! ${nameSpan(survivor, "a")} stands victorious.`
        : `The enemy wins. ${nameSpan(survivor, "b")} stands victorious.`,
      true
    );
  }
}

/** Find the live client-side unit a server event refers to (by side + lane idx). */
function unitByRef(ref) {
  const arr = ref.side === "a" ? state.armyA : state.armyB;
  return arr.find((u) => u.idx === ref.idx) || null;
}

/** New matchup: announce the two front-liners. */
async function replayDuel(ev, setStatus) {
  const a = unitByRef(ev.a);
  const b = unitByRef(ev.b);
  if (a && b) {
    setStatus(`${a.name} vs ${b.name}`);
    log(`— ${nameSpan(a, "a")} (${a.cls}) faces ${nameSpan(b, "b")} (${b.cls}) —`, true);
  }
  await sleep(state.cinematic ? 250 : 500);
}

/**
 * Replay one hit. HP comes from the event (server-authoritative), not from any
 * local calculation — this is the old damage choke point, now a display step.
 */
async function replayStrike(ev) {
  const att = unitByRef(ev.att);
  const def = unitByRef(ev.def);
  if (!att || !def) return;

  if (state.cinematic) {
    await playCutscene(att, ev.att.side, def, ev.def.side, ev.dmg, ev.before, ev.after, def.maxHp);
  }

  def.hp = ev.after;

  const dCard = cardEl(def.id);
  if (dCard && !state.cinematic) floatDamage(dCard, ev.dmg);
  updateCardHp(def);

  log(`${nameSpan(att, ev.att.side)} hits ${nameSpan(def, ev.def.side)} for <b>${ev.dmg}</b>.`);
  await sleep(state.cinematic ? 180 : 620);
}

/** Replay a unit's defeat and bring the next lane forward. */
async function replayFall(ev) {
  const unit = unitByRef(ev);
  if (!unit) return;
  unit.alive = false;
  log(`${nameSpan(unit, ev.side)} has fallen.`, true);
  cardEl(unit.id)?.classList.add("dead");

  // Wait for the death animation, then remove the unit so the survivors shift
  // forward on the board.
  await sleep(state.cinematic ? 350 : 550);
  const army = ev.side === "a" ? state.armyA : state.armyB;
  const idx = army.indexOf(unit);
  if (idx !== -1) army.splice(idx, 1);

  renderBoard(); // remaining units step up into the vacated positions
  await sleep(state.cinematic ? 250 : 400);
}
