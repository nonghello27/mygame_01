# Architecture — how the Trainer game is built

The WHAT is in [GAME_DESIGN.md](./GAME_DESIGN.md); the WHEN is in
[ROADMAP.md](./ROADMAP.md). This file is the technical reference: stack,
directory layout, data model, battle engine, and API surface. When code and
this document disagree, fix one of them in the same change.

## 1. Stack (kept deliberately boring)

- **Client:** vanilla JS ES modules + Vite, CSS/SVG/PNG-sprite rendering.
  No framework until the DOM demonstrably can't keep up (then consider Phaser
  for the battle screen only).
- **Server:** Vercel serverless functions in `api/` (plain Node handlers,
  also served by Vite dev middleware). Stateless per request.
- **DB:** Neon Postgres via `@neondatabase/serverless`. The DB is the only
  state; functions must assume they share nothing between invocations.
- **No websockets, no cron, no queue** until a feature proves it needs them
  (see §6 time). Adventure and battles are request/response.

## 2. The five load-bearing principles

Everything below is an application of these. New code must not violate them.

1. **Server-authoritative.** The client sends *choices* (a formation, a lane
   order, a job id, a step direction) — never stats, damage, rewards, or
   outcomes. Every handler validates choices against DB state (the
   `applyOrder()` permutation check in `api/battle.js` is the model).
2. **Pure engine, event-log replay.** Battle resolution is a pure function
   `(state, seed) → { result, events[] }` with no DOM, no I/O, no wall clock.
   The client only animates the returned events. This is already how
   `shared/engine/resolve.js` + `src/core/battle.js` work; keep that split forever.
3. **Master/instance data.** Baseline content lives in master tables
   (`monster_species`, `skills`, `rune_defs`, …); player-owned things are
   instance rows referencing a master id plus mutable state. Reset = re-copy
   from master. Balance changes = master-table updates.
4. **Content as rows, not branches.** Skills, statuses, rune behaviors, jobs
   and targeting rules are data interpreted by a *small closed set* of engine
   operations. Adding a skill must not add an `if` to the engine.
5. **Lazy time.** Timed things (work, training, cooldowns between matches)
   store `ends_at` timestamps and are resolved on the next authenticated read.
   No server-side timers.

## 3. Directory layout (target)

Current code already fits this shape; new server logic goes in `server/`,
shared pure logic in `shared/`. Migrate existing files opportunistically
(Roadmap phase 0/1), don't big-bang rename.

```
├── api/                  # THIN handlers only: parse → auth → call server/ → respond
│   ├── _db.js            #   (exists) Neon client + JSON helpers
│   ├── auth/…            #   login/session endpoints
│   └── <feature>.js      #   one file per endpoint (Vercel routing)
├── server/               # server-only logic, imported by api/ (never by src/)
│   ├── auth.js           #   Google token verify, session issue/check
│   ├── repos/            #   SQL lives here, one file per aggregate
│   └── services/         #   use-cases: startWork(), resolveMatch(), listMarket()…
├── shared/               # PURE game logic, imported by BOTH api/ and src/
│   ├── engine/           #   battle engine v2 (resolve loop, effects, rng)
│   └── rules/            #   formulas, element chart, targeting registry, constants
├── src/                  # CLIENT only
│   ├── main.js           #   entry; screen router as menus grow
│   ├── services/         #   fetch() wrappers for api/ (the only I/O boundary)
│   ├── screens/          #   one module per menu (arena, farm, summon, market…)
│   ├── ui/  cutscene/  styles/   # (exist) rendering
│   └── data/             #   static client-side content (sprites manifest, fx)
├── db/
│   ├── migrations/       #   NNN_name.sql, applied in order (append-only once live)
│   └── seed.mjs          #   master-data seeding
└── docs/                 # this documentation
```

Rules of the arrows: `src/` never imports `server/`; `server/` never imports
`src/`; `shared/` imports neither. `api/` files stay under ~50 lines — logic
belongs in `server/services/`.

## 4. Data model

Naming: master tables are plural nouns (`monster_species`, `skills`);
instance tables are the owned thing (`monsters`, `trainer_skills`). Instance
rows always carry the owner id and a master FK. Draft core tables:

```sql
-- identity ------------------------------------------------------------------
trainers (
  id            BIGSERIAL PRIMARY KEY,
  auth_provider TEXT NOT NULL,          -- 'google'
  auth_subject  TEXT NOT NULL UNIQUE,   -- provider user id
  name          TEXT NOT NULL,
  exp           BIGINT NOT NULL DEFAULT 0,
  gold          BIGINT NOT NULL DEFAULT 0,
  expertise     TEXT REFERENCES expertises(id),   -- NULL until chosen
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- monsters ------------------------------------------------------------------
monster_species (            -- MASTER: the baseline a new/reset monster copies
  id TEXT PRIMARY KEY,       -- stable string id, e.g. 'sp_flamewolf'
  name TEXT, class TEXT, element TEXT,
  attack_kind TEXT,          -- 'melee' | 'range'
  targeting TEXT,            -- targeting-rule id (shared/rules registry)
  base_str INT, base_agi INT, base_vit INT, base_int INT, base_dex INT,
  rune_slots INT NOT NULL DEFAULT 1,
  sprite TEXT
)
monsters (                   -- INSTANCE: owned, mutable
  id BIGSERIAL PRIMARY KEY,
  trainer_id BIGINT NOT NULL REFERENCES trainers(id),
  species_id TEXT NOT NULL REFERENCES monster_species(id),
  nickname TEXT,
  level INT, exp BIGINT,
  str INT, agi INT, vit INT, int INT, dex INT,   -- current (grown) values
  busy_until TIMESTAMPTZ,    -- lazy lock: working/training until this time
  busy_kind TEXT             -- 'work' | 'training' | 'adventure' | NULL
)

-- skills (same shape for trainer skills with their own pair of tables) -------
skills (                     -- MASTER, shared across species
  id TEXT PRIMARY KEY, name TEXT,
  slot TEXT,                 -- 'passive' | 'normal' | 'ultimate'
  cooldown INT,
  effects JSONB NOT NULL     -- list of effect specs, see §5; per-level scaling inside
)
monster_skills (
  monster_id BIGINT REFERENCES monsters(id),
  skill_id TEXT REFERENCES skills(id),
  slot SMALLINT,             -- 0 passive1, 1 passive2, 2 normal, 3 ultimate
  level INT NOT NULL DEFAULT 1,
  PRIMARY KEY (monster_id, slot)
)

-- runes / equipment / items: same master+instance pattern --------------------
rune_defs(id, name, effects JSONB, max_charges INT, …)
runes(id, trainer_id, def_id, level, charges_left, monster_id NULL, broken BOOL)
equipment_defs(id, domain 'trainer'|'monster', slot, effects JSONB, …)
trainer_equipment(id, trainer_id, def_id, enhance_level, equipped_slot NULL)
monster_equipment(id, trainer_id, def_id, enhance_level, monster_id NULL)
item_defs(id, kind, …) / items(id, trainer_id, def_id, qty)

-- formations & matches --------------------------------------------------------
formations(id, trainer_id, purpose 'attack'|'defense'|'gvg', name)
formation_slots(formation_id, position INT, monster_id, UNIQUE(formation_id, position))
matches (                    -- the anti-cheat session (CLAUDE.md §roadmap, now real)
  id UUID PRIMARY KEY,
  kind TEXT,                 -- 'free' | 'pvp' | 'tournament' | 'gvg'
  attacker_id BIGINT, defender_id BIGINT NULL,
  defender_snapshot JSONB NOT NULL,  -- frozen enemy team: server-picked, tamper-proof
  seed BIGINT NOT NULL,              -- RNG seed; makes the result auditable
  status TEXT NOT NULL DEFAULT 'open',  -- open → resolved (reject replays)
  result JSONB, events JSONB,        -- persisted on resolve
  created_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ
)

-- activities (work / training / adventure steps) ------------------------------
job_defs(id, kind 'work'|'training', duration_s INT, unlock_condition JSONB, rewards JSONB)
activities(id, trainer_id, monster_id, job_id, started_at, ends_at,
           resolved BOOL DEFAULT false, outcome JSONB)

-- later phases: marketplace_listings, guilds, guild_members, seasons,
-- rank_entries, quests, quest_submissions, messages — same patterns.
```

Migration discipline: schema lives in `db/migrations/NNN_*.sql`, applied in
order by `db/migrate.mjs` and tracked in `schema_migrations`. Once a
migration has run against a database with real data it is append-only —
never edit it; add a new file.

## 5. Battle engine v2 (`shared/engine/`)

The successor to today's `shared/engine/resolve.js` (v1), keeping its contract:
**pure, DOM-free, returns an event log** — but generalized from "front units
trade flat hits" to the readiness/effects model of GAME_DESIGN §7.

```
resolveBattle(battleState, seed) → { winner, events[], finalState }
```

- `battleState` is built server-side by `server/services/` from DB rows
  (monsters + skills + runes + equipment + trainer skills), never from client
  values. The same builder snapshot is stored in `matches.defender_snapshot`.
- **Seeded RNG:** one small PRNG (e.g. mulberry32) seeded from `matches.seed`.
  All rolls (ATK min–max, crit, status chance, tie-breaks, targeting
  randomness) go through it. Same state + same seed ⇒ same log — which makes
  results verifiable, testable, and replayable.
- **Readiness loop:** each unit accumulates `gauge += effSpd` per tick; on
  crossing `THRESHOLD`, it takes a turn and the threshold is *subtracted*
  (overflow carries). Ties resolved by seeded roll.
- **Turn pipeline:** the fixed hook sequence from GAME_DESIGN §7.3
  (`turn_start → control → choose action → choose targets → resolve →
  turn_end`). All damage flows through ONE `strike()`-equivalent choke point,
  as today.
- **Effects are data.** An effect spec (stored in `skills.effects` etc.):

  ```js
  { trigger:   "battle_start" | "turn_start" | "on_hit" | "on_being_hit"
             | "after_ally_turns" | "turn_end" | …,
    condition: { … } | null,          // e.g. { targetHpBelowPct: 50 }
    target:    "self"|"front_enemy"|"lowest_hp_ally"|"all_allies"|…,
    op:        "stat_mod"|"damage"|"heal"|"apply_status"|"shield"|…,
    amount:    { base: 10, perLevel: 2, kind: "pct"|"flat" },
    duration:  3,                      // turns, where applicable
    chance:    100 }                   // seeded roll
  ```

  The engine implements the **closed set** of `trigger`s, `target` selectors,
  and `op`s in `shared/rules/`; content JSONB composes them. A genuinely new
  mechanic = one new op/trigger in the registry + content rows — never a
  special case for one skill.
- **Statuses** (stun/freeze/burn/poison/curse…) are just persistent effects
  with a duration, ticked in `turn_start`/checked at the pipeline's control
  and hit steps.
- **Targeting registry** (`shared/rules/targeting.js`): named rules —
  `front`, `random_enemy`, `behind_front`, `backmost_first`, `back_two`,
  `lowest_hp_pct`, … Melee is hard-locked to `front`; the range front-line
  penalty (25%) is a rule in the damage formula, not per-skill data.
- **Termination:** hard turn cap → draw result. Every emitted event carries
  enough data to animate without recomputation (`before`/`after` HP, status
  ids, etc.) — the replayer must never do math.
- **Tests first here.** The engine is the one part of the codebase that gets
  unit tests from day one (`node --test` on fixture states + fixed seeds,
  golden event logs).

The current 3-lane duel game remains expressible in v2 (melee-only, no
skills, flat damage), which is the migration test: v2 must reproduce v1
battles before it grows features.

## 6. Time, sessions, realtime

- **Lazy resolution:** `activities.ends_at` in the past on next read ⇒ the
  service resolves rewards, marks `resolved`, returns the outcome. Same for
  season rollovers (resolve on first read after the boundary). No cron.
- **Match sessions:** `POST /api/match` creates the `matches` row — server
  picks/loads the defender formation, snapshots it, generates the seed —
  then `POST /api/battle { matchId, playerOrder }` resolves once and persists.
  This closes the "client picks the enemy order" hole and rejects replays.
- **Adventure sessions:** a row holding the generated map + party + position;
  each move is a POST that validates and advances it. Only if a future
  feature needs push (live GVG spectating, chat) do we add websockets — and
  then via a hosted realtime service, since Vercel functions can't hold
  sockets.

## 7. Auth

Google Sign-In on the client → ID token POSTed to `api/auth/login` → server
verifies signature/audience → upsert `trainers` row by `(provider, subject)`
→ issue an HttpOnly signed session cookie (JWT). Every mutating endpoint
reads the session; `trainer_id` always comes from the session, **never** the
request body. Keep the provider abstraction thin so "or whatsoever" logins
can be added as more `(provider, subject)` pairs.

## 8. API surface (grows with the roadmap)

```
POST /api/auth/login          idtoken → session cookie (creates trainer)
GET  /api/me                  trainer profile + resolves any finished timers
GET  /api/monsters            owned monsters
POST /api/formation           save formation (choices only: positions + monster ids)
POST /api/match               create match session (server picks defender + seed)
POST /api/battle              { matchId, playerOrder } → persisted result + events
POST /api/activities          start work/training { monsterId, jobId }
POST /api/adventure/*         session create / step
GET  /api/market  POST /api/market/*    listings / buy / sell
(existing: GET /api/rosters, /api/classes — become monster/species reads)
```

Handler contract: authenticate → load DB state → validate the client's
*choice* against it → act → return the new state + any event log. Any value
a handler trusts from the body is a bug.
