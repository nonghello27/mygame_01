// SQL for the PVP ladder (Phase 6 step 4): defense formations, seasons, rank
// entries, and matchmaking candidates. Follows the repos style throughout
// this codebase — queries + row shaping live here; the rules (validation,
// atomic-claim semantics, the season-rollover state machine) live in
// server/services/pvp.js.

import { shapeMonster } from "./monsters.js";

// --- defense formations ----------------------------------------------------

export async function getDefenseFormation(sql, trainerId) {
  const rows = await sql`
    SELECT f.id AS formation_id, f.name, fs.position, fs.monster_id
    FROM formations f
    LEFT JOIN formation_slots fs ON fs.formation_id = f.id
    WHERE f.trainer_id = ${trainerId} AND f.purpose = 'defense'
    ORDER BY fs.position`;
  if (rows.length === 0) return null;
  const { formation_id, name } = rows[0];
  const slots = rows[0].monster_id === null
    ? []
    : rows.map((r) => ({ position: r.position, monsterId: Number(r.monster_id) }));
  return { formationId: Number(formation_id), name, slots };
}

/**
 * Upsert the trainer's defense formation and replace its 3 slots with
 * `monsterIds` in array order (positions 0,1,2) — ONE statement, so a saved
 * formation is never observed half-written (old slots gone, new ones not in
 * yet, or vice versa). Caller (service) validates length/ownership first.
 */
export async function saveDefenseFormation(sql, trainerId, monsterIds, name = "Defense") {
  const [m0, m1, m2] = monsterIds;
  await sql`
    WITH f AS (
      INSERT INTO formations (trainer_id, purpose, name)
      VALUES (${trainerId}, 'defense', ${name})
      ON CONFLICT (trainer_id, purpose) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    ), cleared AS (
      DELETE FROM formation_slots WHERE formation_id = (SELECT id FROM f)
    )
    INSERT INTO formation_slots (formation_id, position, monster_id)
    SELECT f.id, v.position, v.monster_id
    FROM f, (VALUES (0, ${m0}::bigint), (1, ${m1}::bigint), (2, ${m2}::bigint)) AS v(position, monster_id)`;
}

/**
 * A trainer's defense formation, resolved to full battle lanes (monster +
 * species traits + skills, shaped exactly like listMonstersByTrainer rows) in
 * slot-position order — what services/matches.js `toLane` expects as input.
 */
export async function getFormationMonsters(sql, trainerId, purpose = "defense") {
  // Note: no equipment_count/rune_count subselects here — shapeMonster()'s
  // `?? 0` fallback covers their absence, and this row never needs to
  // display gear counts (it only ever feeds toLane()'s battle snapshot).
  const rows = await sql`
    SELECT m.id, m.species_id, m.nickname, m.hp, m.atk, m.spd,
           m.str, m.agi, m.vit, m.intl, m.dex, m.busy_until, m.busy_kind, m.rank,
           s.name AS species_name, s.cls, s.emoji, s.sprite,
           s.element, s.attack_kind, s.attack_style, s.targeting,
           COALESCE(
             (SELECT json_agg(json_build_object(
                       'id', sk.id, 'name', sk.name, 'slot', sk.slot,
                       'cooldown', sk.cooldown, 'data', sk.data, 'level', ms.level)
                     ORDER BY ms.slot)
              FROM monster_skills ms JOIN skills sk ON sk.id = ms.skill_id
              WHERE ms.monster_id = m.id),
             '[]'::json) AS skills
    FROM formations f
    JOIN formation_slots fs ON fs.formation_id = f.id
    JOIN monsters m ON m.id = fs.monster_id
    JOIN monster_species s ON s.id = m.species_id
    WHERE f.trainer_id = ${trainerId} AND f.purpose = ${purpose}
    ORDER BY fs.position`;
  return rows.map(shapeMonster);
}

/**
 * Matchmaking pool: other trainers with a COMPLETE (3-slot) defense
 * formation, closest in rating to `myRating` first. Rating comes from THIS
 * season's rank entry when one exists, else the default start rating — a
 * trainer who never fought this season is still a valid opponent.
 */
export async function listPvpCandidates(sql, trainerId, seasonId, myRating, limit = 5) {
  const rows = await sql`
    SELECT f.trainer_id, t.name, COALESCE(re.rating, 1000) AS rating
    FROM formations f
    JOIN trainers t ON t.id = f.trainer_id
    LEFT JOIN rank_entries re ON re.season_id = ${seasonId} AND re.trainer_id = f.trainer_id
    WHERE f.purpose = 'defense' AND f.trainer_id <> ${trainerId}
      AND (SELECT count(*) FROM formation_slots fs WHERE fs.formation_id = f.id) = 3
    ORDER BY abs(COALESCE(re.rating, 1000) - ${myRating})
    LIMIT ${limit}`;
  return rows.map((r) => ({ trainerId: Number(r.trainer_id), name: r.name, rating: Number(r.rating) }));
}

// --- trainer-skill snapshot (for freezing a side's loadout into a match) ---

export async function getTrainerSkillsSnapshot(sql, trainerId) {
  const rows = await sql`
    SELECT d.id, d.name, ts.level, d.data
    FROM trainer_skills ts JOIN trainer_skill_defs d ON d.id = ts.skill_id
    WHERE ts.trainer_id = ${trainerId}
    ORDER BY ts.slot`;
  return rows.map((r) => ({ id: r.id, name: r.name, level: Number(r.level), data: r.data }));
}

// --- seasons -----------------------------------------------------------------

function shapeSeason(r) {
  if (!r) return null;
  return { id: Number(r.id), startsAt: r.starts_at, endsAt: r.ends_at, status: r.status };
}

export async function getActiveSeason(sql) {
  const rows = await sql`
    SELECT id, starts_at, ends_at, status FROM seasons WHERE status = 'active' LIMIT 1`;
  return shapeSeason(rows[0]);
}

/**
 * Open a new season. Guarded by the `seasons_one_active_idx` partial unique
 * index (008_pvp_guards.sql): if another request already opened one, this
 * throws a unique-violation we swallow into `null` — the caller re-reads
 * getActiveSeason() rather than trusting its own insert raced ahead.
 */
export async function insertSeason(sql, lengthDays) {
  try {
    const rows = await sql`
      INSERT INTO seasons (starts_at, ends_at, status)
      VALUES (now(), now() + make_interval(days => ${lengthDays}), 'active')
      RETURNING id, starts_at, ends_at, status`;
    return shapeSeason(rows[0]);
  } catch (e) {
    if (e.code === "23505") return null; // lost the one-active-season race
    throw e;
  }
}

/** Claim-guarded close: only the caller that flips status wins the right to pay it out. */
export async function claimSeasonClose(sql, seasonId) {
  const rows = await sql`
    UPDATE seasons SET status = 'closed'
    WHERE id = ${seasonId} AND status = 'active' AND ends_at <= now()
    RETURNING id`;
  return rows.length > 0;
}

// --- rank entries --------------------------------------------------------------

function shapeEntry(r) {
  return {
    rating: Number(r.rating), wins: Number(r.wins), losses: Number(r.losses), draws: Number(r.draws),
  };
}

/** Insert a fresh 1000-rating entry if this trainer has none yet, then read it. */
export async function ensureRankEntry(sql, seasonId, trainerId) {
  await sql`
    INSERT INTO rank_entries (season_id, trainer_id) VALUES (${seasonId}, ${trainerId})
    ON CONFLICT (season_id, trainer_id) DO NOTHING`;
  const rows = await sql`
    SELECT rating, wins, losses, draws FROM rank_entries
    WHERE season_id = ${seasonId} AND trainer_id = ${trainerId}`;
  return shapeEntry(rows[0]);
}

export async function topEntries(sql, seasonId, limit = 20) {
  const rows = await sql`
    SELECT re.trainer_id, t.name, re.rating, re.wins, re.losses, re.draws
    FROM rank_entries re JOIN trainers t ON t.id = re.trainer_id
    WHERE re.season_id = ${seasonId}
    ORDER BY re.rating DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    trainerId: Number(r.trainer_id), name: r.name, ...shapeEntry(r),
  }));
}

/** 1-based rank: 1 + how many entries this season strictly outrate this trainer. */
export async function rankOf(sql, seasonId, trainerId) {
  const rows = await sql`
    SELECT 1 + count(*)::int AS rank
    FROM rank_entries re
    WHERE re.season_id = ${seasonId}
      AND re.rating > (
        SELECT rating FROM rank_entries WHERE season_id = ${seasonId} AND trainer_id = ${trainerId}
      )`;
  return Number(rows[0].rank);
}

/**
 * Apply one battle's rating result to BOTH sides in ONE statement — an
 * attacker/defender pair updates atomically together, or (if the update
 * races something else entirely) not at all; there's no window where only
 * one side's rating moved. `outcome` is from the ATTACKER's point of view.
 */
export async function applyRatingResult(sql, seasonId, attackerId, defenderId, deltaA, deltaB, outcome) {
  const aWin = outcome === "win" ? 1 : 0;
  const aLoss = outcome === "loss" ? 1 : 0;
  const aDraw = outcome === "draw" ? 1 : 0;
  // Both CASE branches are bind parameters (no literal in either arm), so
  // Postgres can't infer their type from context alone and defaults to text
  // — explicit ::int casts pin it down (rating/wins/losses/draws are all int).
  await sql`
    UPDATE rank_entries SET
      rating = rating + CASE WHEN trainer_id = ${attackerId} THEN ${deltaA}::int ELSE ${deltaB}::int END,
      wins   = wins   + CASE WHEN trainer_id = ${attackerId} THEN ${aWin}::int  ELSE ${aLoss}::int END,
      losses = losses + CASE WHEN trainer_id = ${attackerId} THEN ${aLoss}::int ELSE ${aWin}::int END,
      draws  = draws  + ${aDraw}::int,
      updated_at = now()
    WHERE season_id = ${seasonId} AND trainer_id IN (${attackerId}, ${defenderId})`;
}

/**
 * Season close payout — ONE CTE statement: rank every unpaid entry
 * (RANK() OVER rating DESC), compute gold by the same tiers as
 * shared/rules/pvp.js seasonRewardGold (kept in sync — this SQL CASE and
 * that JS function must agree in the same commit if the tiers change), pay
 * trainers, and stamp `reward` so a re-run only ever sees reward IS NULL
 * rows — idempotent even if called more than once for the same season.
 */
export async function payoutSeason(sql, seasonId) {
  await sql`
    WITH ranked AS (
      SELECT trainer_id, wins, losses, draws,
             RANK() OVER (ORDER BY rating DESC) AS rnk
      FROM rank_entries
      WHERE season_id = ${seasonId} AND reward IS NULL
    ), rewarded AS (
      SELECT trainer_id, rnk,
        CASE
          WHEN (wins + losses + draws) = 0 THEN 0
          WHEN rnk = 1 THEN 500
          WHEN rnk <= 3 THEN 300
          WHEN rnk <= 10 THEN 150
          ELSE 50
        END AS gold
      FROM ranked
    ), stamped AS (
      UPDATE rank_entries re SET reward = jsonb_build_object('rank', rw.rnk, 'gold', rw.gold)
      FROM rewarded rw
      WHERE re.season_id = ${seasonId} AND re.trainer_id = rw.trainer_id
      RETURNING re.trainer_id, rw.gold
    )
    UPDATE trainers t SET gold = t.gold + s.gold
    FROM stamped s WHERE t.id = s.trainer_id`;
}
