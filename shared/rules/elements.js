// Element advantage chart (GAME_DESIGN §3). A closed data table — new
// elements are new entries here, never branches in the engine.

export const ELEMENTS = ["neutral", "fire", "water", "wind", "earth", "holy", "dark"];

const ADV = 1.25; // attacker has the edge
const DIS = 0.8;  // attacker is resisted

// strong[x] = the element x deals ADV damage to.
// Cycle: fire > wind > earth > water > fire. Holy and dark burn each other.
const STRONG = { fire: "wind", wind: "earth", earth: "water", water: "fire", holy: "dark", dark: "holy" };

/** Damage multiplier for attacker element vs defender element. */
export function elementMultiplier(att, def) {
  if (STRONG[att] === def) return ADV;
  if (STRONG[def] === att) return DIS;
  return 1;
}
