// Single shared game state. Kept deliberately tiny and mutable so any module
// can read it; mutations should flow through here or the battle loop.

import { cloneRoster } from "./units.js";
import { loadRosters, loadClasses } from "../services/content.js";

export const state = {
  /** @type {object[]} index 0 = front lane */
  armyA: [],
  /** @type {object[]} index 0 = front lane */
  armyB: [],
  /** class metadata keyed by class name (attackName + fx); loaded from the DB */
  classes: {},
  /** "setup" | "battle" | "over" */
  phase: "setup",
  /** show full battle cutscenes vs. quick card-only damage */
  cinematic: true,
};

// Roster DEFINITIONS, fetched once through the content service. Cached here so
// resetState() stays synchronous for callers while the source can become a DB.
let defs = { armyA: [], armyB: [] };

/** Fetch rosters + class data via the content boundary, then enter setup. Call once at boot. */
export async function initContent() {
  const [rosters, classes] = await Promise.all([loadRosters(), loadClasses()]);
  defs = rosters;
  // Tag each def with its lane index (front-first, as delivered). This `idx` is
  // the stable key the server and client agree on: the player rearranges units
  // (idx travels with them), and a chosen order is just the list of their idx.
  defs.armyA.forEach((d, i) => { d.idx = i; });
  defs.armyB.forEach((d, i) => { d.idx = i; });
  state.classes = classes;
  resetState();
}

/** Restore both armies to full strength and return to setup. */
export function resetState() {
  state.armyA = cloneRoster(defs.armyA);
  state.armyB = cloneRoster(defs.armyB);
  state.phase = "setup";
}
