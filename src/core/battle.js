// The combat engine. Pure-ish orchestration: it owns the rules (who strikes,
// in what order, when a unit falls) and delegates all presentation to the UI
// and cutscene modules. UI-only concerns (status text, winner banner) are
// injected as hooks so the engine never reaches into page chrome directly.

import { state } from "./state.js";
import { firstAlive, aliveCount } from "./units.js";
import { sleep } from "../utils/helpers.js";
import { log, nameSpan } from "../ui/log.js";
import { renderBoard, cardEl, updateCardHp, floatDamage } from "../ui/board.js";
import { playCutscene } from "../cutscene/cutscene.js";

/**
 * Run a full battle to completion.
 * @param {{ setStatus:(t:string)=>void, showWinner:(youWin:boolean, survivor:object)=>void }} hooks
 */
export async function runBattle({ setStatus, showWinner }) {
  if (state.phase !== "setup") return;
  state.phase = "battle";
  renderBoard();
  log("Battle begins!", true);

  while (aliveCount(state.armyA) && aliveCount(state.armyB)) {
    const a = firstAlive(state.armyA);
    const b = firstAlive(state.armyB);
    setStatus(`${a.name} vs ${b.name}`);
    log(`— ${nameSpan(a, "a")} (${a.cls}) faces ${nameSpan(b, "b")} (${b.cls}) —`, true);
    await sleep(state.cinematic ? 250 : 500);

    // Duel: trade blows until one falls. Higher SPD strikes first; tie favors you.
    let aFirst = a.spd >= b.spd;
    while (a.alive && b.alive && a.hp > 0 && b.hp > 0) {
      const first = aFirst ? a : b;
      const second = aFirst ? b : a;
      const fSide = aFirst ? "a" : "b";
      const sSide = aFirst ? "b" : "a";

      await strike(first, fSide, second, sSide);
      if (second.hp <= 0) { await fall(second, sSide); break; }
      await strike(second, sSide, first, fSide);
      if (first.hp <= 0) { await fall(first, fSide); break; }
    }
  }

  const youWin = aliveCount(state.armyA) > 0;
  const survivor = firstAlive(youWin ? state.armyA : state.armyB);
  state.phase = "over";
  showWinner(youWin, survivor);
  log(
    youWin
      ? `Your army wins! ${nameSpan(survivor, "a")} stands victorious.`
      : `The enemy wins. ${nameSpan(survivor, "b")} stands victorious.`,
    true
  );
}

/**
 * One unit hits another. This is the single damage choke point — hook future
 * mechanics (defense, crit, status ticks, skill triggers) here.
 */
async function strike(att, attSide, def, defSide) {
  const dmg = att.atk;
  const before = def.hp;
  const after = Math.max(0, def.hp - dmg);

  if (state.cinematic) {
    await playCutscene(att, attSide, def, defSide, dmg, before, after, def.maxHp);
  }

  def.hp = after;

  const dCard = cardEl(def.id);
  if (dCard && !state.cinematic) floatDamage(dCard, dmg);
  updateCardHp(def);

  log(`${nameSpan(att, attSide)} hits ${nameSpan(def, defSide)} for <b>${dmg}</b>.`);
  await sleep(state.cinematic ? 180 : 620);
}

/** Mark a unit defeated and bring the next lane forward. */
async function fall(unit, side) {
  unit.alive = false;
  log(`${nameSpan(unit, side)} has fallen.`, true);
  cardEl(unit.id)?.classList.add("dead");

  // Wait for the death animation to finish, then remove the unit from the
  // army array so the remaining units physically shift forward on the board.
  await sleep(state.cinematic ? 350 : 550);
  const army = side === "a" ? state.armyA : state.armyB;
  const idx = army.indexOf(unit);
  if (idx !== -1) army.splice(idx, 1);

  renderBoard(); // remaining units step up into the vacated positions
  await sleep(state.cinematic ? 250 : 400);
}
