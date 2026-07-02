// One-shot DB setup + seed. Applies pending migrations (db/migrations/) and
// loads master data from the current src/data/ modules, so the database starts
// as an exact copy of the local content. Re-runnable: classes and species
// upsert (player-owned rows are never touched).
//
//   npm run db:seed          (reads DATABASE_URL from .env)
//
// When you later edit content, you can either edit the DB directly (it's now the
// source of truth) or tweak data/*.js and re-run this to push the changes.
//
// Uses the Pool (pg-compatible) interface so raw DDL strings work; the runtime
// API in /api uses the lighter neon() HTTP tagged-template instead.

import "dotenv/config";
import { Pool } from "@neondatabase/serverless";
import { migrate } from "./migrate.mjs";
import { ROSTER_A, ROSTER_B } from "../src/data/units.js";
import { CLASS_META } from "../src/data/classes.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Put it in .env (see .env.example).");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 1. Bring the schema up to date.
  await migrate(pool);

  // 2. Classes (upsert so re-running keeps the table in sync).
  for (const [cls, m] of Object.entries(CLASS_META)) {
    await pool.query(
      `INSERT INTO classes (cls, attack_name, fx)
       VALUES ($1, $2, $3)
       ON CONFLICT (cls) DO UPDATE
         SET attack_name = EXCLUDED.attack_name, fx = EXCLUDED.fx`,
      [cls, m.attackName, m.fx]
    );
  }

  // 3. Monster species (master data; upsert keeps stats in sync on re-run).
  // The old army-A roster becomes the STARTER species every new trainer gets;
  // army B becomes the wild/enemy pool. Ids are stable strings — never renumber.
  const speciesFrom = (roster, starter) =>
    roster.map((u) => ({ id: "sp_" + u.name.toLowerCase(), starter, ...u }));
  for (const s of [...speciesFrom(ROSTER_A, true), ...speciesFrom(ROSTER_B, false)]) {
    await pool.query(
      `INSERT INTO monster_species (id, name, cls, emoji, hp, atk, spd, sprite, starter)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, cls = EXCLUDED.cls, emoji = EXCLUDED.emoji,
         hp = EXCLUDED.hp, atk = EXCLUDED.atk, spd = EXCLUDED.spd,
         sprite = EXCLUDED.sprite, starter = EXCLUDED.starter`,
      [s.id, s.name, s.cls, s.emoji, s.hp, s.atk, s.spd, s.sprite ?? null, s.starter]
    );
  }

  const c = await pool.query(`SELECT count(*)::int AS count FROM classes`);
  const sp = await pool.query(`SELECT count(*)::int AS count FROM monster_species`);
  console.log(`Seed complete: ${c.rows[0].count} classes, ${sp.rows[0].count} species.`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
