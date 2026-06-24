// Single shared game state. Kept deliberately tiny and mutable so any module
// can read it; mutations should flow through here or the battle loop.

import { cloneRoster } from "./units.js";
import { ROSTER_A, ROSTER_B } from "../data/units.js";

export const state = {
  /** @type {object[]} index 0 = front lane */
  armyA: [],
  /** @type {object[]} index 0 = front lane */
  armyB: [],
  /** "setup" | "battle" | "over" */
  phase: "setup",
  /** show full battle cutscenes vs. quick card-only damage */
  cinematic: true,
};

/** Restore both armies to full strength and return to setup. */
export function resetState() {
  state.armyA = cloneRoster(ROSTER_A);
  state.armyB = cloneRoster(ROSTER_B);
  state.phase = "setup";
}
