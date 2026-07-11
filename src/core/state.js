// Single shared game state. Kept deliberately tiny and mutable so any module
// can read it; mutations should flow through here or the battle loop.

import { cloneRoster } from "./units.js";
import { loadClasses, createMatch } from "../services/content.js";

export const state = {
  /** current match session id (null until the first match is opened) */
  matchId: null,
  /** @type {object[]} index 0 = front lane — YOUR monsters */
  armyA: [],
  /** @type {object[]} index 0 = front lane — server-picked enemy, order fixed */
  armyB: [],
  /** class metadata keyed by class name (attackName + fx); loaded from the DB */
  classes: {},
  /** "setup" | "battle" | "over" */
  phase: "setup",
  /** show full battle cutscenes vs. quick card-only damage */
  cinematic: true,
  /** the PVP opponent {name, rating} for the match just opened, or null for free play */
  opponent: null,
  /** the staged Adventure fight currently on the battlefield (`{x, y}`,
   *  the maze cell it's blocking — only ever checked for truthiness), or
   *  null when the board holds a normal match; set by loadAdventureBattle(),
   *  cleared by newMatch()/the Continue handoff in main.js */
  adventureBattle: null,
};

// The current match's lane definitions (server snapshots, already idx-tagged).
// Cached so resetState() can rebuild live rosters synchronously.
let defs = { you: [], enemy: [] };

/** Load static content (class metadata). Call once at boot. */
export async function initContent() {
  state.classes = await loadClasses();
}

/**
 * Open a fresh match session for the logged-in trainer: your monsters vs a
 * new server-picked opponent. Replaces the previous match entirely.
 * @param {string} [mode] "pvp" for a ladder match; omit for free play.
 * @param {number[]} [monsterIds] exactly 3 owned, non-busy monster ids
 *   choosing WHICH monsters fight (Phase 10.2); omit for the server's
 *   default (first 3 available) — passed straight through to createMatch().
 * @param {string} [keepEnemyMatchId] (Phase 10.4) the caller's own prior
 *   free match id whose frozen enemy to reuse; passed straight through to
 *   createMatch().
 */
export async function newMatch(mode, monsterIds, keepEnemyMatchId) {
  const match = await createMatch(mode, monsterIds, keepEnemyMatchId);
  state.matchId = match.matchId;
  state.opponent = match.opponent ?? null;
  state.adventureBattle = null; // a fresh match always evicts an adventure fight from the board
  defs = { you: match.you, enemy: match.enemy };
  resetState();
}

/**
 * Load a staged Adventure fight's frozen snapshots (the same toLane() lane
 * shape a match's you/enemy arrive in) onto the battlefield in place of a
 * match (Phase 10.14, carried over to the grid maze by Phase 11).
 * @param {{x:number, y:number, party:object[], enemy:object[]}} pending the
 *   active session's `pendingBattle` (services/content.js's
 *   fetchAdventureState()/moveAdventure() shape).
 */
export function loadAdventureBattle(pending) {
  state.matchId = null;
  state.opponent = null;
  state.adventureBattle = { x: pending.x, y: pending.y };
  defs = { you: pending.party, enemy: pending.enemy };
  resetState();
}

/** Restore both armies of the CURRENT match to full strength, back to setup. */
export function resetState() {
  state.armyA = cloneRoster(defs.you);
  state.armyB = cloneRoster(defs.enemy);
  state.phase = "setup";
}
