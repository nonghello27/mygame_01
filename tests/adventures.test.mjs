// Adventure master-data grammar + pure grid-maze/loot rules checks (Phase 11
// — Adventure 2.0, sub-phase 11.1) — the same role tests/summons.test.mjs
// plays for the Summon Hall: every row of the seed content must pass its own
// validator unchanged, every referenced species/item must be real, and
// generateGridMap()/visibleCellKeys()/deriveNodeSeed()/rollLoot()/
// rollEncounter() must be deterministic (CLAUDE.md §1.6) and obey the
// documented shape/connectivity/density rules. The DB-touching session
// service (server/services/adventure.js, Phase 11.2) is exercised the same
// way matches.js/pvp.js are — not unit-tested here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ADVENTURES } from "../src/data/adventures.js";
import { ITEMS } from "../src/data/items.js";
import { ROSTER_A, ROSTER_B } from "../src/data/units.js";
import { validateAdventure } from "../server/services/adminValidate.js";
import {
  CELL, cellKey, generateGridMap, visibleCellKeys, deriveNodeSeed, rollLoot, rollEncounter,
} from "../shared/rules/adventure.js";
import { makeRng } from "../shared/engine/rng.js";

const DIFFICULTIES = ["easy", "medium", "hard"];
const SEEDS = [1, 42, 12345, 999999, 2026];

test("adventure ids are unique, ad_-prefixed, and every row validates unchanged", () => {
  const ids = ADVENTURES.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate adventure id");
  for (const id of ids) assert.match(id, /^ad_[a-z0-9_]+$/);

  for (const ad of ADVENTURES) {
    const v = validateAdventure(ad);
    assert.equal(v.id, ad.id);
    assert.equal(v.name, ad.name);
    assert.deepEqual(v.config, ad.config, `${ad.id}: config changed in validation`);
  }
});

test("every encounters speciesId is a real species id derived from src/data/units.js", () => {
  const speciesIds = new Set([...ROSTER_A, ...ROSTER_B].map((u) => "sp_" + u.name.toLowerCase()));
  for (const ad of ADVENTURES) {
    for (const e of ad.config.encounters) {
      assert.ok(speciesIds.has(e.speciesId), `${ad.id}: encounters speciesId "${e.speciesId}" is not a known species`);
    }
  }
});

test("every loot itemId exists in src/data/items.js", () => {
  const itemIds = new Set(ITEMS.map((i) => i.id));
  for (const ad of ADVENTURES) {
    for (const row of ad.config.loot) {
      assert.ok(itemIds.has(row.itemId), `${ad.id}: itemId "${row.itemId}" is not a known item`);
    }
  }
});

// --- generateGridMap ---------------------------------------------------------

/** Flood-fill from the entrance over every non-rock cell; returns the visited-key set. */
function floodFill(map) {
  const seen = new Set([cellKey(map.entrance.x, map.entrance.y)]);
  const stack = [map.entrance];
  while (stack.length > 0) {
    const { x, y } = stack.pop();
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) continue;
      if (map.cells[ny][nx] === CELL.ROCK) continue;
      const key = cellKey(nx, ny);
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push({ x: nx, y: ny });
    }
  }
  return seen;
}

for (const ad of ADVENTURES) {
  for (const difficulty of DIFFICULTIES) {
    test(`generateGridMap(${ad.id}, ${difficulty}) is deterministic across seeds`, () => {
      for (const seed of SEEDS) {
        const first = generateGridMap(ad.config, difficulty, seed);
        const second = generateGridMap(ad.config, difficulty, seed);
        assert.deepEqual(second, first, `seed ${seed} must reproduce the same map`);
      }
    });

    test(`generateGridMap(${ad.id}, ${difficulty}): dimensions and cell values`, () => {
      for (const seed of SEEDS) {
        const map = generateGridMap(ad.config, difficulty, seed);
        assert.equal(map.width, ad.config.width);
        assert.equal(map.height, ad.config.height);
        assert.equal(map.cells.length, ad.config.height, "cells must have `height` rows");
        for (const row of map.cells) {
          assert.equal(row.length, ad.config.width, "each row must have `width` cols");
          for (const c of row) assert.ok(Object.values(CELL).includes(c), `unexpected cell value "${c}"`);
        }
      }
    });

    test(`generateGridMap(${ad.id}, ${difficulty}): entrance is on the border, open, and content-free`, () => {
      for (const seed of SEEDS) {
        const map = generateGridMap(ad.config, difficulty, seed);
        const { x, y } = map.entrance;
        const onBorder = x === 0 || x === map.width - 1 || y === 0 || y === map.height - 1;
        assert.ok(onBorder, `seed ${seed}: entrance (${x},${y}) is not on the border`);
        assert.equal(map.cells[y][x], CELL.OPEN, `seed ${seed}: entrance cell must be open, never content`);
      }
    });

    test(`generateGridMap(${ad.id}, ${difficulty}): the whole maze is connected from the entrance`, () => {
      for (const seed of SEEDS) {
        const map = generateGridMap(ad.config, difficulty, seed);
        const reached = floodFill(map);
        for (let y = 0; y < map.height; y++) {
          for (let x = 0; x < map.width; x++) {
            if (map.cells[y][x] === CELL.ROCK) continue;
            assert.ok(reached.has(cellKey(x, y)), `seed ${seed}: (${x},${y}) is non-rock but unreachable from the entrance`);
          }
        }
      }
    });

    test(`generateGridMap(${ad.id}, ${difficulty}): monster/item counts match the spec'd round/clamp formula`, () => {
      const d = ad.config.difficulties[difficulty];
      for (const seed of SEEDS) {
        const map = generateGridMap(ad.config, difficulty, seed);
        let openCount = 0, monsterCount = 0, itemCount = 0;
        for (let y = 0; y < map.height; y++) {
          for (let x = 0; x < map.width; x++) {
            const c = map.cells[y][x];
            if (x === map.entrance.x && y === map.entrance.y) continue;
            if (c === CELL.ROCK) continue;
            openCount++;
            if (c === CELL.MONSTER) monsterCount++;
            if (c === CELL.ITEM) itemCount++;
          }
        }
        const expectedMonsters = Math.round((openCount * d.monsterPct) / 100);
        const expectedItems = Math.min(Math.round((openCount * d.itemPct) / 100), openCount - expectedMonsters);
        assert.equal(monsterCount, expectedMonsters, `seed ${seed}: monster count mismatch`);
        assert.equal(itemCount, expectedItems, `seed ${seed}: item count mismatch`);
      }
    });
  }
}

// --- visibleCellKeys ---------------------------------------------------------

test("visibleCellKeys: includes every visited key plus its orthogonal in-bounds neighbors, excludes diagonals, returns a Set", () => {
  // A hand-built 5x5 grid, visited = the single interior cell (2,2).
  const visited = [cellKey(2, 2)];
  const visible = visibleCellKeys(5, 5, visited);
  assert.ok(visible instanceof Set);
  assert.ok(visible.has(cellKey(2, 2)), "visited cell itself must be visible");
  for (const [x, y] of [[2, 1], [3, 2], [2, 3], [1, 2]]) {
    assert.ok(visible.has(cellKey(x, y)), `orthogonal neighbor (${x},${y}) must be visible`);
  }
  for (const [x, y] of [[1, 1], [3, 1], [1, 3], [3, 3]]) {
    assert.ok(!visible.has(cellKey(x, y)), `diagonal neighbor (${x},${y}) must NOT be visible`);
  }
  assert.equal(visible.size, 5, "exactly the visited cell + its 4 orthogonal neighbors");
});

test("visibleCellKeys: drops neighbors that fall out of bounds (a border/corner visited cell)", () => {
  // Top-left corner of a 5x5 grid — only 2 in-bounds orthogonal neighbors exist.
  const visible = visibleCellKeys(5, 5, [cellKey(0, 0)]);
  assert.equal(visible.size, 3, "corner (0,0) + its 2 in-bounds neighbors, nothing negative");
  assert.ok(visible.has(cellKey(0, 0)));
  assert.ok(visible.has(cellKey(1, 0)));
  assert.ok(visible.has(cellKey(0, 1)));
});

test("visibleCellKeys: unions correctly across multiple visited cells", () => {
  const visible = visibleCellKeys(5, 5, [cellKey(0, 0), cellKey(4, 4)]);
  assert.ok(visible.has(cellKey(0, 0)) && visible.has(cellKey(4, 4)));
  assert.ok(visible.has(cellKey(1, 0)) && visible.has(cellKey(3, 4)));
  assert.equal(visible.size, 6, "two corners, 3 cells apiece, no overlap");
});

// --- deriveNodeSeed / rollLoot / rollEncounter (unchanged grammar) -----------

test("deriveNodeSeed returns stable ints in [0, 0x7fffffff) and differs across positions", () => {
  const seed = 12345;
  for (let position = 0; position < 10; position++) {
    const first = deriveNodeSeed(seed, position);
    assert.equal(deriveNodeSeed(seed, position), first, `position ${position} must be stable`);
    assert.ok(Number.isInteger(first));
    assert.ok(first >= 0 && first < 0x7fffffff);
  }
  const values = new Set();
  for (let position = 0; position < 10; position++) values.add(deriveNodeSeed(seed, position));
  assert.ok(values.size > 1, "different positions should (almost always) derive different seeds");
});

test("rollLoot returns a table row's itemId with qty within [qtyMin, qtyMax]", () => {
  const table = [
    { itemId: "it_potion_small", weight: 50, qtyMin: 1, qtyMax: 2 },
    { itemId: "it_enhance_stone", weight: 40, qtyMin: 1, qtyMax: 3 },
    { itemId: "it_summon_scroll", weight: 10, qtyMin: 1, qtyMax: 1 },
  ];
  const rng = makeRng(deriveNodeSeed(999, 2));
  for (let i = 0; i < 20; i++) {
    const { itemId, qty } = rollLoot(table, rng);
    const row = table.find((r) => r.itemId === itemId);
    assert.ok(row, `rollLoot returned unknown itemId "${itemId}"`);
    assert.ok(qty >= row.qtyMin && qty <= row.qtyMax, `qty ${qty} out of bounds for ${itemId}`);
  }
});

const ENCOUNTERS = [
  { speciesId: "sp_vorth", weight: 40 },
  { speciesId: "sp_mesha", weight: 35 },
  { speciesId: "sp_gronk", weight: 25 },
];

test("rollEncounter is deterministic: same encounters + seeded rng state always returns the same n draws", () => {
  for (const seed of [1, 42, 12345, 999999]) {
    const first = rollEncounter(ENCOUNTERS, makeRng(seed), 3);
    const second = rollEncounter(ENCOUNTERS, makeRng(seed), 3);
    assert.deepEqual(second, first, `seed ${seed} must reproduce the same draws`);
  }
});

test("rollEncounter shape: returns n speciesIds, all from the table (with replacement)", () => {
  const rng = makeRng(2024);
  const known = new Set(ENCOUNTERS.map((e) => e.speciesId));
  const draws = rollEncounter(ENCOUNTERS, rng, 3);
  assert.equal(draws.length, 3);
  for (const speciesId of draws) {
    assert.ok(known.has(speciesId), `rollEncounter returned unknown speciesId "${speciesId}"`);
  }
});

test("rollEncounter: over many seeds, every table entry gets drawn at least once", () => {
  const seen = new Set();
  for (let seed = 0; seed < 300; seed++) {
    for (const speciesId of rollEncounter(ENCOUNTERS, makeRng(seed), 3)) seen.add(speciesId);
  }
  for (const e of ENCOUNTERS) {
    assert.ok(seen.has(e.speciesId), `speciesId "${e.speciesId}" was never drawn across 300 seeds`);
  }
});
