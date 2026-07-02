// Ordered, tracked schema migrations for Neon/Postgres.
//
//   npm run db:migrate       (reads DATABASE_URL from .env)
//
// Files in db/migrations/ named NNN_description.sql are applied in filename
// order, exactly once each; applied names are recorded in schema_migrations.
// Once a migration has run against a database that holds real data, treat it
// as append-only: never edit it, add a new NNN file instead.

import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);

/** Apply all pending migrations using the given pg-compatible pool. */
export async function migrate(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  const { rows } = await pool.query(`SELECT name FROM schema_migrations`);
  const applied = new Set(rows.map((r) => r.name));

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = (await readFile(new URL(file, MIGRATIONS_DIR), "utf8"))
      .replace(/^\s*--.*$/gm, ""); // strip line comments so ';' in them can't split a statement
    await pool.query("BEGIN");
    try {
      for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
        await pool.query(stmt);
      }
      await pool.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
      await pool.query("COMMIT");
    } catch (e) {
      await pool.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${e.message}`);
    }
    console.log(`Applied ${file}`);
    ran++;
  }
  if (!ran) console.log("No pending migrations.");
  return ran;
}

// CLI entry: `node db/migrate.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Put it in .env (see .env.example).");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  migrate(pool)
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
