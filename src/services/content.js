// Content boundary — the single place the game asks for its DATA (rosters,
// classes, sprite manifest). Rosters + classes now come from Postgres (Neon)
// via the serverless API in /api; core/ and ui/ are untouched because they
// already await these functions. Sprites stay a local manifest for now (pure
// visual config, consumed synchronously by ui/sprite.js) — migrate it the same
// way by adding /api/sprites and switching loadSprites() to getJson.

import { SPRITES } from "../data/sprites.js";

/** GET a JSON endpoint, throwing on a non-2xx so callers fail loudly. */
async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

/** POST a JSON body, surfacing the server's error message on a non-2xx. */
async function postJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `POST ${path} failed: ${res.status}`);
  return data;
}

/** @returns {Promise<{armyA: object[], armyB: object[]}>} unit DEFINITIONS (not live instances). */
export async function loadRosters() {
  return getJson("/api/rosters");
}

/** @returns {Promise<Record<string, object>>} class metadata keyed by class name. */
export async function loadClasses() {
  return getJson("/api/classes");
}

/** @returns {Promise<Record<string, object>>} sprite manifest keyed by sprite id. */
export async function loadSprites() {
  return SPRITES;
}

/**
 * Resolve a battle on the server. Sends only the chosen lane ORDERS (permutations
 * of each army's indices); the server owns the stats and decides the outcome.
 * @param {number[]} playerOrder player army lane indices, front-first
 * @param {number[]} enemyOrder  enemy army lane indices, front-first
 * @returns {Promise<{youWin:boolean, survivor:{side:string,idx:number}|null, events:object[]}>}
 */
export async function requestBattle(playerOrder, enemyOrder) {
  return postJson("/api/battle", { playerOrder, enemyOrder });
}
