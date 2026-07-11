// Adventure grid-maze generation + loot/encounter rolls (Phase 7.4 step B's
// original step-list foundations, replaced by Phase 11's explorable maze).
// Pure — no DB, no I/O — so the server can call these against a frozen
// adventure_defs.config + a minted seed, and the client could import the
// same module to preview a route without re-deriving the formula
// (CLAUDE.md §1: one source of truth for numbers a player sees).
//
// Determinism (CLAUDE.md §1.6): same config + difficulty + seed always
// returns the same maze; same table + same rng state always returns the
// same loot/encounter roll. The CALLER (server/services/adventure.js) mints
// the session seed the same way match creation and Summon Hall pulls do
// (Math.floor(Math.random() * 0x7fffffff)) and stores it on the
// adventure_sessions row, so any run's maze AND every cell's rolls are
// replayable from that one stored seed.

import { makeRng, mulberry32 } from "../engine/rng.js";

/**
 * Weighted pick of one row from a list of `{weight, ...}` objects, using
 * exactly one rng roll. Kept local (not imported from shared/rules/summon.js)
 * so this module stays self-contained, matching the existing rules modules'
 * one-file-one-concern style.
 * @param {{weight:number}[]} rows non-empty, weight >= 1
 * @param {{next:() => number}} rng
 */
function weightedPick(rows, rng) {
  const total = rows.reduce((sum, r) => sum + r.weight, 0);
  let roll = rng.next() * total;
  for (const row of rows) {
    roll -= row.weight;
    if (roll < 0) return row;
  }
  // Floating-point guard: a roll that lands exactly on the total (or a
  // rounding hair past it) falls through to the last row instead of
  // returning undefined.
  return rows[rows.length - 1];
}

/**
 * A grid cell's kind (Phase 11 — the maze replacing the step-list). "rock" is
 * impassable; "open"/"monster"/"item" are all passable, "monster"/"item"
 * additionally carrying content the player resolves by stepping onto them.
 * Content stays DATA (a cell kind), never an engine branch — the same
 * "content as rows" philosophy CLAUDE.md §1.4 holds the skill/status/job
 * registries to.
 */
export const CELL = { ROCK: "rock", OPEN: "open", MONSTER: "monster", ITEM: "item" };

/** Canonical string key for a grid coordinate — used as a Set/Map key and,
 * later, as the `visited`/`cleared` jsonb columns' element shape (11.2). */
export const cellKey = (x, y) => `${x},${y}`;

/**
 * Generate one difficulty's maze: a width×height grid of CELL.* values, a
 * border entrance, and monster/item content scattered over the carved-open
 * floor. Pure + seeded (CLAUDE.md §1.6): same config + difficulty + seed
 * always returns a deeply-equal map, so a session only ever needs to store
 * its seed, never the map itself.
 *
 * ONE rng stream (makeRng(seed)), consumed in this exact fixed order so the
 * result is fully reproducible:
 *
 *   1. Entrance: `edge = rng.int(0, 3)` (0 top, 1 right, 2 bottom, 3 left),
 *      then `offset = rng.int(0, len - 1)` where len is `width` for the
 *      top/bottom edges or `height` for the left/right edges. That border
 *      cell becomes the entrance and is opened immediately.
 *   2. Carve (randomized DFS / "growing tree"): every cell starts ROCK
 *      except the entrance; a stack begins holding just the entrance. While
 *      the stack isn't empty: look at its top cell, collect its orthogonal
 *      in-bounds ROCK neighbors that have EXACTLY ONE already-open
 *      orthogonal neighbor (examined in the fixed order up/right/down/left);
 *      if there are none, pop the stack; otherwise pick one candidate via
 *      `rng.int(0, candidates.length - 1)`, open it, and push it. The
 *      "exactly one open neighbor" rule is what keeps the maze loop-free and
 *      fully connected: every cell that ever gets opened is, at the moment
 *      it opens, adjacent to exactly one already-reachable cell, so there is
 *      always exactly one path back to the entrance and never a cycle.
 *   3. Content: collect every open cell EXCEPT the entrance in row-major
 *      order (y outer, x inner) — a fixed, deterministic ordering so the
 *      Fisher–Yates shuffle below always shuffles the identical list for a
 *      given seed. Let `n` be that list's length and
 *      `d = config.difficulties[difficulty]`. `monsterCount =
 *      Math.round(n * d.monsterPct / 100)`; `itemCount =
 *      Math.min(Math.round(n * d.itemPct / 100), n - monsterCount)` (clamped
 *      so the two never together exceed `n`, however the percentages round).
 *      Fisher–Yates shuffle the list in place — for `i` from `n - 1` down to
 *      1, swap element `i` with `rng.int(0, i)` — then the first
 *      `monsterCount` entries become CELL.MONSTER and the next `itemCount`
 *      become CELL.ITEM; everything left over stays CELL.OPEN.
 *
 * @param {{width:number, height:number,
 *   difficulties:Object<string,{monsterPct:number, itemPct:number}>}} config
 * @param {string} difficulty a key of `config.difficulties` — the CALLER
 *   (server/services/adventure.js, Phase 11.2) validates that; this function
 *   assumes it's already a real key.
 * @param {number} seed 32-bit integer
 * @returns {{width:number, height:number, entrance:{x:number,y:number},
 *   cells:string[][]}} `cells[y][x]` is one of CELL.*; `cells` is
 *   `height`-long, each row `width`-long.
 */
export function generateGridMap(config, difficulty, seed) {
  const { width, height } = config;
  const rng = makeRng(seed);

  // --- 1. entrance -----------------------------------------------------------
  const edge = rng.int(0, 3); // 0 top, 1 right, 2 bottom, 3 left
  let entrance;
  if (edge === 0) entrance = { x: rng.int(0, width - 1), y: 0 };
  else if (edge === 1) entrance = { x: width - 1, y: rng.int(0, height - 1) };
  else if (edge === 2) entrance = { x: rng.int(0, width - 1), y: height - 1 };
  else entrance = { x: 0, y: rng.int(0, height - 1) };

  // --- grid init: every cell rock except the entrance -------------------------
  const cells = Array.from({ length: height }, () => Array.from({ length: width }, () => CELL.ROCK));
  cells[entrance.y][entrance.x] = CELL.OPEN;

  // --- 2. carve: randomized DFS / growing-tree --------------------------------
  // Fixed neighbor examination order (up, right, down, left) so "collect
  // candidates" is deterministic given the rng draws — the rng itself only
  // ever picks WHICH candidate, never the order they're considered in.
  const DIRS = [
    [0, -1], // up
    [1, 0], // right
    [0, 1], // down
    [-1, 0], // left
  ];
  const inBounds = (x, y) => x >= 0 && x < width && y >= 0 && y < height;
  const openNeighborCount = (x, y) => {
    let n = 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && cells[ny][nx] !== CELL.ROCK) n++;
    }
    return n;
  };

  const stack = [entrance];
  while (stack.length > 0) {
    const { x, y } = stack[stack.length - 1];
    const candidates = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && cells[ny][nx] === CELL.ROCK && openNeighborCount(nx, ny) === 1) {
        candidates.push({ x: nx, y: ny });
      }
    }
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    const next = candidates[rng.int(0, candidates.length - 1)];
    cells[next.y][next.x] = CELL.OPEN;
    stack.push(next);
  }

  // --- 3. content: monster/item density over the carved-open floor -----------
  const open = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (cells[y][x] === CELL.OPEN && !(x === entrance.x && y === entrance.y)) open.push({ x, y });
    }
  }
  const d = config.difficulties[difficulty];
  const n = open.length;
  const monsterCount = Math.round((n * d.monsterPct) / 100);
  const itemCount = Math.min(Math.round((n * d.itemPct) / 100), n - monsterCount);

  // Fisher–Yates, standard descending-i form.
  for (let i = open.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [open[i], open[j]] = [open[j], open[i]];
  }
  for (let i = 0; i < monsterCount; i++) cells[open[i].y][open[i].x] = CELL.MONSTER;
  for (let i = monsterCount; i < monsterCount + itemCount; i++) cells[open[i].y][open[i].x] = CELL.ITEM;

  return { width, height, entrance, cells };
}

/**
 * The fog-of-war disclosure rule (Phase 11): a session view ships ONLY
 * terrain for cells the party has actually visited plus each visited cell's
 * orthogonal in-bounds neighbors — never the full map (the same "ship only
 * what's in front of the player" philosophy the old step-list session used
 * for its current-step-only view). Pure so 11.2's `toSessionView` can just
 * call this over the session's stored `visited` list.
 * @param {number} width
 * @param {number} height
 * @param {string[]} visitedKeys array of "x,y" strings (cellKey() shape)
 * @returns {Set<string>}
 */
export function visibleCellKeys(width, height, visitedKeys) {
  const visible = new Set();
  for (const key of visitedKeys) {
    visible.add(key);
    const [x, y] = key.split(",").map(Number);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) visible.add(cellKey(nx, ny));
    }
  }
  return visible;
}

/**
 * Derive the per-cell seed used for that cell's own rolls (a monster cell's
 * fight seed plus its post-win catch/reward rolls, an item cell's loot
 * roll). Advances a FRESH mulberry32 stream — seeded from the session's
 * stored seed XORed with a cell-index-dependent constant — exactly once, and
 * scales the result into the 32-bit range every other seed in this codebase
 * is stored as.
 *
 * WHY a fresh stream per cell instead of continuing to draw from the maze's
 * carve rng: every roll of the whole run must be auditable from the ONE
 * stored session seed + the cell's index alone, with NO cross-cell
 * correlation (drawing cell N's roll wouldn't perturb cell N+1's roll, and a
 * cell can be re-derived in isolation without replaying every cell before
 * it — useful for an abandoned-session cleanup or a future "peek at cell N"
 * read).
 *
 * @param {number} seed the session's stored seed
 * @param {number} position the cell's index, `y·width + x` (0-based)
 * @returns {number} a 32-bit integer in [0, 0x7fffffff)
 */
export function deriveNodeSeed(seed, position) {
  const mixed = (seed ^ Math.imul(position + 1, 0x9e3779b9)) >>> 0;
  const next = mulberry32(mixed);
  return Math.floor(next() * 0x7fffffff);
}

/**
 * Weighted pick of one loot/gather table row, then a uniform qty roll within
 * that row's [qtyMin, qtyMax]. Takes an already-made rng (built by the
 * caller from deriveNodeSeed) rather than a raw seed, so one node can roll
 * this multiple times off the same seeded stream (e.g. a chest that grants
 * more than one stack).
 * @param {{itemId:string, weight:number, qtyMin:number, qtyMax:number}[]} table
 * @param {ReturnType<typeof makeRng>} rng
 * @returns {{itemId:string, qty:number}}
 */
export function rollLoot(table, rng) {
  const row = weightedPick(table, rng);
  return { itemId: row.itemId, qty: rng.int(row.qtyMin, row.qtyMax) };
}

/**
 * Draw `n` speciesIds from a weighted encounter table, WITH replacement — one
 * rng roll per draw (server/services/adventure.js's battle-node resolver
 * calls this with n = PARTY_SIZE to build the wild team, using the SAME
 * node-seeded rng deriveNodeSeed() produced, continuing the same accounting
 * style as rollLoot: one call, one roll, per pick). Takes an already-made rng
 * (built by the caller from deriveNodeSeed), same contract as rollLoot.
 * @param {{speciesId:string, weight:number}[]} encounters non-empty, weight >= 1
 * @param {ReturnType<typeof makeRng>} rng
 * @param {number} n how many to draw
 * @returns {string[]} n speciesIds, duplicates allowed
 */
export function rollEncounter(encounters, rng, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(weightedPick(encounters, rng).speciesId);
  return out;
}
