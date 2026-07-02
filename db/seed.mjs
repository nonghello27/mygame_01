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
import { SKILLS } from "../src/data/skills.js";
import { CLASS_META } from "../src/data/classes.js";
import { JOBS } from "../src/data/jobs.js";

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

  // 3. Skills (master data; upsert so balance edits land on re-run).
  for (const sk of SKILLS) {
    await pool.query(
      `INSERT INTO skills (id, name, slot, cooldown, data)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, slot = EXCLUDED.slot,
         cooldown = EXCLUDED.cooldown, data = EXCLUDED.data`,
      [sk.id, sk.name, sk.slot, sk.cooldown, JSON.stringify(sk.data)]
    );
  }

  // 4. Monster species + born-with loadouts (upsert; loadouts replaced whole).
  // The old army-A roster is the STARTER species every new trainer gets;
  // army B is the wild/enemy pool. Ids are stable strings — never renumber.
  const speciesFrom = (roster, starter) =>
    roster.map((u) => ({ id: "sp_" + u.name.toLowerCase(), starter, ...u }));
  const species = [...speciesFrom(ROSTER_A, true), ...speciesFrom(ROSTER_B, false)];
  for (const s of species) {
    await pool.query(
      `INSERT INTO monster_species
         (id, name, cls, emoji, hp, atk, spd, sprite, starter,
          element, attack_kind, attack_style, targeting, str, agi, vit, intl, dex)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, cls = EXCLUDED.cls, emoji = EXCLUDED.emoji,
         hp = EXCLUDED.hp, atk = EXCLUDED.atk, spd = EXCLUDED.spd,
         sprite = EXCLUDED.sprite, starter = EXCLUDED.starter,
         element = EXCLUDED.element, attack_kind = EXCLUDED.attack_kind,
         attack_style = EXCLUDED.attack_style, targeting = EXCLUDED.targeting,
         str = EXCLUDED.str, agi = EXCLUDED.agi, vit = EXCLUDED.vit,
         intl = EXCLUDED.intl, dex = EXCLUDED.dex`,
      [s.id, s.name, s.cls, s.emoji, s.hp, s.atk, s.spd, s.sprite ?? null, s.starter,
       s.element, s.attackKind, s.attackStyle, s.targeting,
       s.attrs.str, s.attrs.agi, s.attrs.vit, s.attrs.int, s.attrs.dex]
    );
    await pool.query(`DELETE FROM species_skills WHERE species_id = $1`, [s.id]);
    for (let slot = 0; slot < s.skills.length; slot++) {
      if (!s.skills[slot]) continue;
      await pool.query(
        `INSERT INTO species_skills (species_id, slot, skill_id) VALUES ($1, $2, $3)`,
        [s.id, slot, s.skills[slot]]
      );
    }
  }

  // 5. Jobs (work & training master data; upsert so balance edits land).
  for (const j of JOBS) {
    await pool.query(
      `INSERT INTO job_defs (id, kind, name, duration_s, rewards)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind, name = EXCLUDED.name,
         duration_s = EXCLUDED.duration_s, rewards = EXCLUDED.rewards`,
      [j.id, j.kind, j.name, j.durationS, JSON.stringify(j.rewards)]
    );
  }

  const c = await pool.query(`SELECT count(*)::int AS count FROM classes`);
  const sp = await pool.query(`SELECT count(*)::int AS count FROM monster_species`);
  const sk = await pool.query(`SELECT count(*)::int AS count FROM skills`);
  const jb = await pool.query(`SELECT count(*)::int AS count FROM job_defs`);
  console.log(
    `Seed complete: ${c.rows[0].count} classes, ${sp.rows[0].count} species, ` +
    `${sk.rows[0].count} skills, ${jb.rows[0].count} jobs.`
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
