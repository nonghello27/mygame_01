// Content boundary — the single place the game asks for its DATA (matches,
// classes, sprite manifest) or posts battle choices. Everything authoritative
// comes from the serverless API in /api; core/ and ui/ are untouched because
// they already await these functions. Sprites stay a local manifest for now
// (pure visual config, consumed synchronously by ui/sprite.js).

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

/** @returns {Promise<Record<string, object>>} class metadata keyed by class name. */
export async function loadClasses() {
  return getJson("/api/classes");
}

/** @returns {Promise<Record<string, object>>} sprite manifest keyed by sprite id. */
export async function loadSprites() {
  return SPRITES;
}

/**
 * Open a match session. The server assembles YOUR team from your owned
 * monsters (granting starters on the very first call) and picks + freezes the
 * enemy team and lane order. Requires login.
 * @returns {Promise<{matchId:string, you:object[], enemy:object[]}>}
 */
export async function createMatch() {
  return postJson("/api/match", {});
}

/**
 * Resolve a match on the server. The only choice the client sends is the lane
 * ORDER of its own army (a permutation of idx); the server owns the stats,
 * the enemy, and the outcome. Each match resolves exactly once.
 * @param {string} matchId
 * @param {number[]} playerOrder player army lane indices, front-first
 * @returns {Promise<{youWin:boolean, survivor:{side:string,idx:number}|null, events:object[]}>}
 */
export async function requestBattle(matchId, playerOrder) {
  return postJson("/api/battle", { matchId, playerOrder });
}
