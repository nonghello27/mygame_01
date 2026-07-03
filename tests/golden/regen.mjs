// Regenerate the golden battle logs from the current engine. Run ONLY after
// an intentional combat-rules change, and commit the diff together with that
// change (see README.md).
//
//   node tests/golden/regen.mjs

import { writeFile } from "node:fs/promises";
import { resolveBattle } from "../../shared/engine/resolve.js";
import { BATTLES } from "../fixtures.mjs";

for (const [name, { seed, rosterA, rosterB, trainers }] of Object.entries(BATTLES)) {
  const result = resolveBattle(rosterA, rosterB, seed, trainers);
  await writeFile(
    new URL(`./${name}.json`, import.meta.url),
    JSON.stringify(result, null, 2) + "\n"
  );
  console.log(`Wrote ${name}.json (${result.events.length} events, seed ${seed})`);
}
