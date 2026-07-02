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
 */
export async function newMatch() {
  const match = await createMatch();
  state.matchId = match.matchId;
  defs = { you: match.you, enemy: match.enemy };
  resetState();
}

/** Restore both armies of the CURRENT match to full strength, back to setup. */
export function resetState() {
  state.armyA = cloneRoster(defs.you);
  state.armyB = cloneRoster(defs.enemy);
  state.phase = "setup";
}
