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
import { EXPERTISES } from "../src/data/expertises.js";
import { ITEMS } from "../src/data/items.js";
import { EQUIPMENT } from "../src/data/equipment.js";
import { RUNES } from "../src/data/runes.js";
import { SUMMONS } from "../src/data/summons.js";
import { ADVENTURES } from "../src/data/adventures.js";

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
          element, attack_kind, attack_style, targeting, str, agi, vit, intl, dex, rune_slots)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, cls = EXCLUDED.cls, emoji = EXCLUDED.emoji,
         hp = EXCLUDED.hp, atk = EXCLUDED.atk, spd = EXCLUDED.spd,
         sprite = EXCLUDED.sprite, starter = EXCLUDED.starter,
         element = EXCLUDED.element, attack_kind = EXCLUDED.attack_kind,
         attack_style = EXCLUDED.attack_style, targeting = EXCLUDED.targeting,
         str = EXCLUDED.str, agi = EXCLUDED.agi, vit = EXCLUDED.vit,
         intl = EXCLUDED.intl, dex = EXCLUDED.dex, rune_slots = EXCLUDED.rune_slots`,
      [s.id, s.name, s.cls, s.emoji, s.hp, s.atk, s.spd, s.sprite ?? null, s.starter,
       s.element, s.attackKind, s.attackStyle, s.targeting,
       s.attrs.str, s.attrs.agi, s.attrs.vit, s.attrs.int, s.attrs.dex, s.runeSlots ?? 1]
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

  // 6. Expertises + trainer skills (upsert so balance edits land on re-run).
  for (const ex of EXPERTISES) {
    await pool.query(
      `INSERT INTO expertises (id, name)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [ex.id, ex.name]
    );
    for (const ts of ex.skills) {
      await pool.query(
        `INSERT INTO trainer_skill_defs (id, expertise_id, name, data)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           expertise_id = EXCLUDED.expertise_id, name = EXCLUDED.name, data = EXCLUDED.data`,
        [ts.id, ex.id, ts.name, JSON.stringify(ts.data)]
      );
    }
  }

  // 7. Items, equipment, runes (master data; upsert so balance edits land).
  for (const it of ITEMS) {
    await pool.query(
      `INSERT INTO item_defs (id, kind, name, description, sell_gold)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind, name = EXCLUDED.name, description = EXCLUDED.description,
         sell_gold = EXCLUDED.sell_gold`,
      [it.id, it.kind, it.name, it.description ?? null, it.sellGold ?? 0]
    );
  }
  for (const eq of EQUIPMENT) {
    await pool.query(
      `INSERT INTO equipment_defs (id, domain, slot, name, description, effects, enhance, sell_gold)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
       ON CONFLICT (id) DO UPDATE SET
         domain = EXCLUDED.domain, slot = EXCLUDED.slot, name = EXCLUDED.name,
         description = EXCLUDED.description, effects = EXCLUDED.effects, enhance = EXCLUDED.enhance,
         sell_gold = EXCLUDED.sell_gold`,
      [eq.id, eq.domain, eq.slot, eq.name, eq.description ?? null,
       JSON.stringify(eq.effects), eq.enhance ? JSON.stringify(eq.enhance) : null, eq.sellGold ?? 0]
    );
  }
  for (const rn of RUNES) {
    await pool.query(
      `INSERT INTO rune_defs (id, name, description, effects, max_charges, repair_gold, sell_gold)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description, effects = EXCLUDED.effects,
         max_charges = EXCLUDED.max_charges, repair_gold = EXCLUDED.repair_gold,
         sell_gold = EXCLUDED.sell_gold`,
      [rn.id, rn.name, rn.description ?? null, JSON.stringify(rn.effects), rn.maxCharges, rn.repairGold,
       rn.sellGold ?? 0]
    );
  }

  // 8. Summon Hall banners (Phase 7.4 step A; upsert so balance edits land).
  for (const sm of SUMMONS) {
    await pool.query(
      `INSERT INTO summon_defs (id, name, description, cost, pool, enabled)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         cost = EXCLUDED.cost, pool = EXCLUDED.pool, enabled = EXCLUDED.enabled`,
      [sm.id, sm.name, sm.description ?? "", JSON.stringify(sm.cost), JSON.stringify(sm.pool),
       sm.enabled ?? true]
    );
  }

  // 9. Adventure routes (Phase 7.4 step B; upsert so balance edits land).
  for (const ad of ADVENTURES) {
    await pool.query(
      `INSERT INTO adventure_defs (id, name, description, config, enabled)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         config = EXCLUDED.config, enabled = EXCLUDED.enabled`,
      [ad.id, ad.name, ad.description ?? "", JSON.stringify(ad.config), ad.enabled ?? true]
    );
  }

  const c = await pool.query(`SELECT count(*)::int AS count FROM classes`);
  const sp = await pool.query(`SELECT count(*)::int AS count FROM monster_species`);
  const sk = await pool.query(`SELECT count(*)::int AS count FROM skills`);
  const jb = await pool.query(`SELECT count(*)::int AS count FROM job_defs`);
  const ex = await pool.query(`SELECT count(*)::int AS count FROM expertises`);
  const ts = await pool.query(`SELECT count(*)::int AS count FROM trainer_skill_defs`);
  const it = await pool.query(`SELECT count(*)::int AS count FROM item_defs`);
  const eq = await pool.query(`SELECT count(*)::int AS count FROM equipment_defs`);
  const rn = await pool.query(`SELECT count(*)::int AS count FROM rune_defs`);
  const sm = await pool.query(`SELECT count(*)::int AS count FROM summon_defs`);
  const ad = await pool.query(`SELECT count(*)::int AS count FROM adventure_defs`);
  console.log(
    `Seed complete: ${c.rows[0].count} classes, ${sp.rows[0].count} species, ` +
    `${sk.rows[0].count} skills, ${jb.rows[0].count} jobs, ` +
    `${ex.rows[0].count} expertises, ${ts.rows[0].count} trainer skills, ` +
    `${it.rows[0].count} items, ${eq.rows[0].count} equipment, ${rn.rows[0].count} runes, ` +
    `${sm.rows[0].count} summon banners, ${ad.rows[0].count} adventures.`
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
