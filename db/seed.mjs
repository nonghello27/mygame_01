// One-shot DB setup + seed. Creates the tables (db/schema.sql) and loads them
// from the current src/data/ modules, so the database starts as an exact copy
// of the local content. Re-runnable: classes upsert, units are replaced.
//
//   npm run db:seed          (reads DATABASE_URL from .env)
//
// When you later edit content, you can either edit the DB directly (it's now the
// source of truth) or tweak data/*.js and re-run this to push the changes.
//
// Uses the Pool (pg-compatible) interface so raw DDL strings work; the runtime
// API in /api uses the lighter neon() HTTP tagged-template instead.

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";
import { ROSTER_A, ROSTER_B } from "../src/data/units.js";
import { CLASS_META } from "../src/data/classes.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Put it in .env (see .env.example).");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 1. Create tables (idempotent DDL from schema.sql). Strip line comments first
  // so a stray ';' inside a comment can't split a statement.
  const ddl = (await readFile(new URL("./schema.sql", import.meta.url), "utf8"))
    .replace(/^\s*--.*$/gm, "");
  for (const stmt of ddl.split(";").map((s) => s.trim()).filter(Boolean)) {
    await pool.query(stmt);
  }

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

  // 3. Units (replace wholesale to keep lane order clean).
  await pool.query(`DELETE FROM units`);
  const insertArmy = async (army, roster) => {
    let ord = 0;
    for (const u of roster) {
      await pool.query(
        `INSERT INTO units (army, ord, name, cls, emoji, hp, atk, spd, sprite)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [army, ord, u.name, u.cls, u.emoji, u.hp, u.atk, u.spd, u.sprite ?? null]
      );
      ord++;
    }
  };
  await insertArmy("A", ROSTER_A);
  await insertArmy("B", ROSTER_B);

  const c = await pool.query(`SELECT count(*)::int AS count FROM classes`);
  const u = await pool.query(`SELECT count(*)::int AS count FROM units`);
  console.log(`Seed complete: ${c.rows[0].count} classes, ${u.rows[0].count} units.`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
