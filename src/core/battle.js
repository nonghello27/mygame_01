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
import { requestBattle, resolveAdventureBattle } from "../services/content.js";
import { sleep } from "../utils/helpers.js";
import { log, nameSpan } from "../ui/log.js";
import { renderBoard, cardEl, updateCardHp, updateCardStatuses, floatDamage } from "../ui/board.js";
import { skillIconHtml } from "../ui/skillMedia.js";
import { playCutscene } from "../cutscene/cutscene.js";

/**
 * Run a full battle to completion by asking the server to resolve it, then
 * replaying the returned events.
 * @param {{ setStatus:(t:string)=>void, showWinner:(youWin:boolean, survivor:object)=>void }} hooks
 * @returns {Promise<{youWin:boolean, events:object[], survivor:object|null,
 *   pvp?:object, adventure?:{session:object, node:object}}|undefined>} the
 *   resolved result (undefined if the battle couldn't be resolved at all —
 *   the early error path below already left the board back in setup).
 */
export async function runBattle({ setStatus, showWinner }) {
  if (state.phase !== "setup") return;
  state.phase = "battle";
  renderBoard();
  log("Battle begins!", true);

  // The only thing the client decides is the lane ORDER of its own army;
  // the enemy's composition and order were frozen when the match (or, for
  // an Adventure fight, the staged pendingBattle) was created.
  const playerOrder = state.armyA.map((u) => u.idx);

  let result;
  try {
    if (state.adventureBattle) {
      // An adventure fight resolves through its own endpoint against the
      // session's frozen snapshots — same permutation choice, same replayed
      // event log; `adventure` carries the raw `{session, node}` for
      // main.js to hand back to the Adventure panel.
      const res = await resolveAdventureBattle(playerOrder);
      result = { youWin: res.node.battle.won, events: res.node.battle.events, survivor: null, adventure: res };
    } else {
      result = await requestBattle(state.matchId, playerOrder);
    }
  } catch (e) {
    log(`Battle could not be resolved: ${e.message}`, true);
    setStatus("Connection error — try again");
    state.phase = "setup";
    return;
  }

  for (const ev of result.events) {
    if (ev.t === "turn") await replayTurn(ev, setStatus);
    else if (ev.t === "skill") replaySkill(ev);
    else if (ev.t === "tskill") replayTrainerSkill(ev);
    else if (ev.t === "rune") replayRune(ev);
    else if (ev.t === "strike") await replayStrike(ev);
    else if (ev.t === "miss") await replayMiss(ev);
    else if (ev.t === "dot") await replayDot(ev);
    else if (ev.t === "status") replayStatus(ev);
    else if (ev.t === "status_end") replayStatusEnd(ev);
    else if (ev.t === "heal") await replayHeal(ev);
    else if (ev.t === "buff") replayBuff(ev);
    else if (ev.t === "skip") await replaySkip(ev);
    else if (ev.t === "fall") await replayFall(ev);
    else if (ev.t === "draw") log("Neither side can finish it — the battle is a draw.", true);
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
  // Ranked matches carry a rating delta the server already applied — display
  // only, no math beyond formatting the sign.
  if (result.pvp) {
    const d = result.pvp.yourDelta;
    log(`Rating: ${d >= 0 ? "+" : ""}${d} → ${result.pvp.yourRating}`, true);
  }
  return result;
}

/** Find the live client-side unit a server event refers to (by side + lane idx). */
function unitByRef(ref) {
  const arr = ref.side === "a" ? state.armyA : state.armyB;
  return arr.find((u) => u.idx === ref.idx) || null;
}

/** A unit's readiness gauge filled — its turn begins. */
async function replayTurn(ev, setStatus) {
  const u = unitByRef(ev);
  if (u) setStatus(`${u.name}'s turn`);
  await sleep(state.cinematic ? 120 : 250);
}

function replaySkill(ev) {
  const u = unitByRef(ev);
  if (!u) return;
  const found = u.skills?.find((s) => s.id === ev.skill);
  log(`${skillIconHtml(found ?? {})}${nameSpan(u, ev.side)} uses <b>${ev.name}</b>!`, true);
}

/** A trainer skill fires (battle_start or after_ally_turns) — announce it;
 * the heal/status/buff events that follow already animate themselves. */
function replayTrainerSkill(ev) {
  log(`Trainer skill: <b>${ev.name}</b>!`, true);
}

/** A socketed rune fires (battle_start perm_stat, or a target_select
 * override spends its charge for this turn) — announce it; no math, no
 * state, same synchronous shape as replayBuff/replaySkill. */
function replayRune(ev) {
  const u = unitByRef(ev);
  if (u) log(`${nameSpan(u, ev.side)}'s <b>${ev.name}</b> flares!`, true);
}

async function replayMiss(ev) {
  const att = unitByRef(ev.att);
  const def = unitByRef(ev.def);
  if (!att || !def) return;
  const card = cardEl(def.id);
  if (card) floatDamage(card, "MISS");
  log(`${nameSpan(att, ev.att.side)} misses ${nameSpan(def, ev.def.side)}.`);
  await sleep(state.cinematic ? 240 : 400);
}

/** Burn/poison tick at the start of a unit's turn. */
async function replayDot(ev) {
  const u = unitByRef(ev);
  if (!u) return;
  u.hp = ev.after;
  const card = cardEl(u.id);
  if (card) floatDamage(card, ev.dmg);
  updateCardHp(u);
  log(`${nameSpan(u, ev.side)} suffers <b>${ev.dmg}</b> from ${ev.status}.`);
  await sleep(300);
}

function replayStatus(ev) {
  const u = unitByRef(ev);
  if (!u) return;
  if (!u.statuses.includes(ev.status)) u.statuses.push(ev.status);
  updateCardStatuses(u);
  log(`${nameSpan(u, ev.side)} is afflicted: <b>${ev.status}</b> (${ev.turns} turns).`);
}

function replayStatusEnd(ev) {
  const u = unitByRef(ev);
  if (!u) return;
  u.statuses = u.statuses.filter((s) => s !== ev.status);
  updateCardStatuses(u);
}

async function replayHeal(ev) {
  const u = unitByRef(ev);
  if (!u) return;
  u.hp = ev.after;
  updateCardHp(u);
  log(`${nameSpan(u, ev.side)} recovers <b>${ev.amount}</b> HP.`);
  await sleep(300);
}

function replayBuff(ev) {
  const u = unitByRef(ev);
  if (u) log(`${nameSpan(u, ev.side)}'s passive raises its ${ev.stat}.`);
}

async function replaySkip(ev) {
  const u = unitByRef(ev);
  if (!u) return;
  log(`${nameSpan(u, ev.side)} is stunned and cannot act!`, true);
  await sleep(400);
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

  const notes = [
    ev.crit ? " <b>CRIT!</b>" : "",
    ev.eff === "strong" ? " It's super effective!" : ev.eff === "weak" ? " It's resisted." : "",
  ].join("");
  log(`${nameSpan(att, ev.att.side)} hits ${nameSpan(def, ev.def.side)} for <b>${ev.dmg}</b>.${notes}`);
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
