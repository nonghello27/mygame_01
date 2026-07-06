# Architecture — how the Trainer game is built

The WHAT is in [GAME_DESIGN.md](./GAME_DESIGN.md); the WHEN is in
[ROADMAP.md](./ROADMAP.md). This file is the technical reference: stack,
directory layout, data model, battle engine, and API surface. When code and
this document disagree, fix one of them in the same change.

## 1. Stack (kept deliberately boring)

- **Client:** vanilla JS ES modules + Vite, CSS/SVG/PNG-sprite rendering.
  No framework until the DOM demonstrably can't keep up (then consider Phaser
  for the battle screen only).
- **Server:** 6 Vercel serverless functions, one per domain —
  `api/auth/[...route].js`, `api/battle/[...route].js`,
  `api/trainer/[...route].js`, `api/activities.js`, `api/admin/[...route].js`,
  `api/adventure/[...route].js` (Phase 7.4 step B — the first new domain
  added since the original five)
  — each dispatching its domain's `/api/*` requests through its own table in
  `server/routers/<domain>.js` (plain Node handlers; the Vite dev middleware
  calls the matching router directly). Domain-grouped, not one-per-endpoint,
  because the Vercel Hobby plan caps a deployment at 12 functions; growth
  inside a domain (new route in an existing table) never costs a new
  function. Stateless per request.
- **DB:** Neon Postgres via `@neondatabase/serverless`. The DB is the only
  state; functions must assume they share nothing between invocations.
- **No websockets, no cron, no queue** until a feature proves it needs them
  (see §6 time). Adventure and battles are request/response.

## 2. The five load-bearing principles

Everything below is an application of these. New code must not violate them.

1. **Server-authoritative.** The client sends *choices* (a formation, a lane
   order, a job id, a step direction) — never stats, damage, rewards, or
   outcomes. Every handler validates choices against DB state (the
   `applyOrder()` permutation check behind `server/routes/battle.js` is the
   model).
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
├── api/                  # 6 serverless functions (Hobby 12-function cap), one per domain:
│   ├── auth/[...route].js      #   /api/auth/*      → server/routers/auth.js
│   ├── battle/[...route].js    #   /api/battle/*     → server/routers/battle.js
│   ├── trainer/[...route].js   #   /api/trainer/*    → server/routers/trainer.js
│   ├── activities.js           #   /api/activities   → server/routers/activities.js (plain file)
│   ├── admin/[...route].js     #   /api/admin/*      → server/routers/admin.js
│   └── adventure/[...route].js #   /api/adventure/*  → server/routers/adventure.js
├── server/               # server-only logic, imported by api/ (never by src/)
│   ├── routers/          #   one file per domain: createRouter({pathname→{METHOD:handler}})
│   ├── routes/           #   THIN handlers only: parse → auth → call services → respond
│   ├── db.js             #   Neon client (lazy connection)
│   ├── auth.js           #   Google token verify, session issue/check
│   ├── http.js           #   httpError + sendJson/readJson helpers
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
`src/`; `shared/` imports neither. `server/routes/` files stay under ~50
lines — logic belongs in `server/services/`. New route in an existing
domain = a handler in `server/routes/` + one row in that domain's table in
`server/routers/<domain>.js`; a genuinely new domain = a new
`api/<domain>/[...route].js` + `server/routers/<domain>.js` pair — the only
time to add a file under `api/`.

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

-- skills (trainer skills are the SAME shape, their own master+instance pair) -
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

-- items / equipment / runes (Phase 7.1, real: 009_items.sql) -----------------
-- effects JSONB below: same battle_start/perm_stat grammar as skill passives,
-- plus an optional perLevel (skills don't get one) for 7.2's enhancement math
item_defs(id TEXT PK, kind 'material'|'consumable', name, description)
items(id, trainer_id, def_id, qty INT DEFAULT 0, UNIQUE(trainer_id, def_id))
equipment_defs(id TEXT PK, domain 'trainer'|'monster', slot TEXT,
  name, description, effects JSONB, enhance JSONB)  -- enhance: {maxLevel,
                                                     -- goldPerLevel,
                                                     -- material?:{itemId,
                                                     -- qtyPerLevel}} or NULL
                                                     -- (material added 7.2)
trainer_equipment(id, trainer_id, def_id, enhance_level DEFAULT 0,
                   equipped_slot NULL)   -- NULL = in the bag
monster_equipment(id, trainer_id, def_id, enhance_level DEFAULT 0,
                   monster_id NULL)      -- NULL = in the bag
rune_defs(id TEXT PK, name, description, effects JSONB,
          max_charges INT, repair_gold INT DEFAULT 0)
runes(id, trainer_id, def_id, level DEFAULT 1, charges_left INT,
      broken BOOL DEFAULT false, monster_id NULL)   -- NULL = in the bag
-- monster_species.rune_slots (added by 009_items.sql, DEFAULT 1) — read by 7.3
-- both equipment (7.2) and socketed runes (7.3) feed a battle snapshot (see
-- §5's toLane()/resolveBattle() notes below). Granting is admin-only
-- (POST /api/admin/grant); the Summon Hall below is the player-facing path.

-- summon hall (Phase 7.4 step A, real: 010_summons.sql) -----------------------
summon_defs(id TEXT PK,             -- 'sm_novice' — stable, never renumber
  name, description, enabled BOOL DEFAULT true,   -- retirement lever; a
                                     -- referenced def is 409-undeletable anyway
  cost JSONB NOT NULL,               -- [{type:'gold',amount} | {type:'item',
                                      --   itemId, qty}] — pluggable requirement
                                      --   registry (server/services/summon.js
                                      --   REQUIREMENT_CHECKERS); a later
                                      --   'quest' type is one new entry
  pool JSONB NOT NULL)               -- [{speciesId, weight}]; shared/rules/
                                      --   summon.js rollSummon() draws one,
                                      --   weighted, per pull
summons(id, trainer_id, summon_id REFERENCES summon_defs(id),
  cost JSONB, pool JSONB,            -- SNAPSHOTS of the def at pull time —
                                      --   an audit row never drifts if the
                                      --   banner is edited later
  seed BIGINT NOT NULL,              -- stored ⇒ auditable/replayable
  result_species_id TEXT NOT NULL, monster_id BIGINT REFERENCES monsters(id),
  created_at)                        -- one row per pull; never touches a
                                      --   battle snapshot

-- trainer progression (Phase 6, real: 007_pvp.sql) ----------------------------
expertises(id, name)                    -- MASTER: the 3 trainer archetypes
trainer_skill_defs(                     -- MASTER: 2 learnable skills per expertise
  id TEXT PRIMARY KEY, expertise_id TEXT REFERENCES expertises(id), name TEXT,
  data JSONB NOT NULL                   -- { effects:[...] }, same grammar as skills.effects
)
trainer_skills (                        -- INSTANCE: the trainer's 2 fixed learn slots
  trainer_id BIGINT REFERENCES trainers(id),
  slot SMALLINT CHECK (slot IN (0, 1)),
  skill_id TEXT REFERENCES trainer_skill_defs(id),
  level INT NOT NULL DEFAULT 1,
  PRIMARY KEY (trainer_id, slot)
)

-- formations & matches (Phase 6 real; kind/defender_id/*_trainer added by
-- 007_pvp.sql on top of the matches shape createMatch already used) ----------
formations(id, trainer_id, purpose 'attack'|'defense'|'gvg' DEFAULT 'defense', name,
           UNIQUE(trainer_id, purpose))    -- one formation per trainer per purpose today
formation_slots(formation_id, position INT, monster_id, UNIQUE(formation_id, position))
matches (                    -- the anti-cheat session (CLAUDE.md §roadmap, now real)
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'free', -- 'free' | 'pvp' (tournament/gvg are later phases)
  attacker_id BIGINT, defender_id BIGINT NULL,   -- defender_id set only for kind='pvp'
  attacker_snapshot JSONB NOT NULL, defender_snapshot JSONB NOT NULL,  -- frozen lanes
                                      -- (lanes may carry an `equipment` array
                                      -- of the monster's equipped gear, 7.2,
                                      -- and a `runes` array of its socketed
                                      -- runes with their frozen chargesLeft, 7.3)
  attacker_trainer JSONB, defender_trainer JSONB, -- frozen trainer-side loadout,
                                      -- pvp only: {skills, equipment} (7.2 widened
                                      -- this from a bare skills array; pre-7.2
                                      -- rows are read as {skills: [...], equipment: []})
  seed BIGINT NOT NULL,              -- RNG seed; makes the result auditable
  status TEXT NOT NULL DEFAULT 'open',  -- open → resolved (reject replays)
  result JSONB, events JSONB,        -- persisted on resolve; pvp result carries
                                      -- result.pvp = {yourDelta, theirDelta, yourRating};
                                      -- resolveMatch (7.3) also settles rune
                                      -- durability from the engine's runeUse
                                      -- tally after the resolve claim wins —
                                      -- not itself persisted onto this row
  created_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ
)

-- the ladder (Phase 6 real) ----------------------------------------------------
seasons(id, starts_at, ends_at, status 'active'|'closed' DEFAULT 'active')
  -- a partial unique index enforces at most one 'active' season at a time
rank_entries (
  season_id BIGINT REFERENCES seasons(id), trainer_id BIGINT REFERENCES trainers(id),
  rating INT NOT NULL DEFAULT 1000, wins INT, losses INT, draws INT,
  reward JSONB,               -- season-end gold payout, stamped once (idempotent)
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (season_id, trainer_id)
)

-- activities (work / training / adventure steps) ------------------------------
job_defs(id, kind 'work'|'training', name, duration_s INT, rewards JSONB, unlock JSONB)
  -- rewards by kind: work {gold, trainerExp} | training {attr, gain}
activities(id, trainer_id, monster_id, job_id, started_at, ends_at,
           resolved BOOL DEFAULT false, outcome JSONB)

-- later phases: marketplace_listings, guilds, guild_members, quests,
-- quest_submissions, messages, tournament/gvg match kinds — same patterns.
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
- **Effects are data.** The implemented grammar (in `skills.data`, JSONB;
  see `src/data/skills.js` for live examples):

  ```js
  { power:   { scale: "phys"|"mag", pct: 120, perLevel: 5 },   // damage roll multiplier
    target:  { rule: <targeting.js key>, count: n|"all" },     // defaults to species pattern
    onHit:   [{ op: "apply_status", status, chance, turns, pct? }],
    support: [{ op: "heal"|"apply_status", target: {rule,count}, … }],  // allies pool
    passive: [{ when: "battle_start", op: "perm_stat", stat, pct?|flat? }] }
  ```

  More triggers (`on_being_hit`, conditions) join this grammar as later
  phases need them — as new keys, not engine branches.

  The engine implements the **closed set** of `trigger`s, `target` selectors,
  and `op`s in `shared/rules/`; content JSONB composes them. A genuinely new
  mechanic = one new op/trigger in the registry + content rows — never a
  special case for one skill.

  **Trainer skills** (Phase 6, GAME_DESIGN §7.1) reuse this exact grammar
  from a second source: `resolveBattle(laneA, laneB, seed, trainers)` takes a
  4th arg, `{a:{skills, equipment}, b:{skills, equipment}}` — each side's
  up-to-2 learned trainer skills (`equipment` is the trainer-domain gear
  added by Phase 7.2, same `battle_start` grammar, PVP-only side-wide aura,
  no target rule), frozen into the match row the same way lanes are. Two
  triggers fire trainer skills: `battle_start` (before unit passives) and
  `after_ally_turns` (once
  every currently-alive unit on that side has taken a turn since it last
  fired). Targets always pool over the caster's own side. Each firing emits a
  `tskill` event before its effects, so the replayer can announce it exactly
  like a unit's `skill` event.

  **Equipment** (Phase 7.2) rides the same `battle_start` op set from a
  third source: a lane may carry an `equipment` array (the monster's
  equipped monster-domain gear, gathered by `toLane()` from
  `server/services/matches.js`), and `trainers.{a,b}.equipment` above is the
  trainer-domain side. Full firing order at `battle_start`: trainer skills →
  unit passives → monster-domain equipment (per-unit) → trainer-domain
  equipment (side-wide aura). Enhancement scales an effect's `flat`/`pct` via
  `perLevel * (enhanceLevel)`, the same per-level math skills don't get.

  **Runes** (Phase 7.3) are a fourth source, socketed per-unit rather than a
  side-wide aura, and land LAST in the `battle_start` order (after
  trainer-domain equipment). A lane's `runes` array (`server/repos/runes.js`
  `listSocketedRunes`, gathered by `toLane()`'s 4th argument) carries each
  socketed instance's frozen `chargesLeft` plus its def's `effects`, which are
  EITHER the same `battle_start`/`perm_stat` grammar as equipment OR a
  rune-only trigger, `{when:"target_select", op:"override_targeting", rule}`
  — evaluated when a unit chooses that turn's target, steering it to the
  named `targeting.js` rule instead of the skill's/species' default. Both
  triggers are metered the same way: **one trigger = one charge = one `rune`
  event** (`{t:"rune", side, idx, rune:<defId>, name}`), regardless of how
  many `battle_start` effects a single def carries; `fireRune()` decrements a
  LOCAL, mutable copy of the lane's frozen `chargesLeft` and goes silent
  (no event, next rune/default targeting tried instead) once that copy hits
  0 — the engine never writes charge state itself. It only *reports*
  consumption via the returned `runeUse:{a:Object<instanceId,count>,
  b:Object<instanceId,count>}` tally (keyed by the owned rune row's id, not
  the def id), which `resolveMatch()` (`server/services/matches.js`) spends
  against the DB — **attacker side only** — after the resolve claim wins,
  same once-only guard Elo already rides: `applyRuneWear` decrements
  `charges_left` by instance id (never by the frozen snapshot state, so a
  rune repaired/resocketed since the snapshot froze wears correctly, and one
  reassigned/deleted since is silently skipped), breaking (`charges_left`
  hits 0) and auto-unsocketing (`monster_id -> NULL`) in the same guarded
  UPDATE as the decrement. A PVP defender's runes never decay this way —
  their formation is a frozen snapshot fought while they're offline, and
  only `runeUse.a` (the attacking/acting side, in every match kind) is ever
  applied.
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
- **Match sessions:** `POST /api/battle/match` creates the `matches` row —
  server picks/loads the defender formation, snapshots it, generates the
  seed — then `POST /api/battle/resolve { matchId, playerOrder }` resolves
  once and persists.
  This closes the "client picks the enemy order" hole and rejects replays.
- **Adventure sessions:** a row holding the generated map + party + position;
  each move is a POST that validates and advances it exactly once
  (`claimAdvance`, same claim-guard shape as `applyOrder`), resolving battle
  nodes with a direct `resolveBattle()` call rather than a `matches` row.
  `ends_at` is the lazy-time valve (same shape as season rollover): an
  overdue 'active' session is marked 'abandoned' on next read, no cron.
  Only if a future feature needs push (live GVG spectating, chat) do we add
  websockets — and then via a hosted realtime service, since Vercel
  functions can't hold sockets.

## 7. Auth

**Firebase Authentication** handles the login UX on the client
(`src/services/firebase.js`; Google popup and email/password — register +
password reset — today, more providers are a Firebase-console toggle). The
client shows a landing/login screen and keeps the game (`#app`) hidden until
`GET /api/trainer/me` confirms a session. Firebase is the identity *provider only* — the game
session is ours: the client POSTs the Firebase ID token to `/api/auth/login`,
the server verifies it locally (RS256 against Google's published securetoken
certs; audience = `FIREBASE_PROJECT_ID`, issuer checked — no firebase-admin
dependency), upserts the `trainers` row keyed by `('firebase', uid)` (the uid
stays stable when more providers are linked to the account), and issues an
HttpOnly HMAC-signed session cookie. Every mutating endpoint reads the
session; `trainer_id` always comes from the session, **never** the request
body. The Firebase web config in the client is public by design; the only
server secrets are `SESSION_SECRET` and `DATABASE_URL`.

## 8. API surface (grows with the roadmap)

The surface below groups URLs by the domain that owns them: 6 serverless
functions, each internally routing multiple endpoints via a static table in
its `server/routers/<domain>.js` — the Vercel Hobby plan's 12-function limit
is the reason for grouping (never a file-per-endpoint), and growth inside a
domain (a new route) never costs a new function. Two domains renamed their
URLs when they picked up a prefix that collided with an existing endpoint
name: `/api/match` → `/api/battle/match`, `/api/battle` →
`/api/battle/resolve`, `/api/me` → `/api/trainer/me`, `/api/classes` →
`/api/trainer/classes`, `/api/progression` → `/api/trainer/progression`,
`/api/trainer-skills` → `/api/trainer/skills`. `auth`, `activities`, and
`admin` kept their existing URLs.

```
# auth domain — api/auth/[...route].js
POST /api/auth/login          idtoken → session cookie (creates trainer)
POST /api/auth/logout         clears the session cookie

# trainer domain — api/trainer/[...route].js
GET  /api/trainer/me          trainer profile + resolves any finished timers
                              + trainerSkills (the 2 learned trainer-skill slots)
GET  /api/trainer/classes     class metadata
GET  /api/trainer/progression expertises + trainer_skill_defs + this trainer's
                              expertise/exp/learned skills, in one call
POST /api/trainer/progression { expertiseId } → pick/switch expertise (switching
                              wipes both learned skill slots)
POST /api/trainer/skills      { slot, skillId } → learn a trainer skill into a
                              learn slot, or clear it (skillId: null)
GET  /api/trainer/inventory   items + equipment (bag + equipped) + runes, one
                              call (Phase 7.1; ROADMAP drafted /api/inventory,
                              but a new top-level domain would cost another
                              serverless function — grouped here instead, same
                              reasoning as the /api/me → /api/trainer/me rename)
POST /api/trainer/equipment/equip    { domain:'trainer'|'monster', equipmentId,
                              monsterId?:number|null, equip?:boolean } → equip/
                              unequip one owned piece (monster domain: monsterId,
                              null unequips; trainer domain: equip boolean);
                              returns the refreshed inventory (Phase 7.2; same
                              grouping reasoning as /api/trainer/inventory)
POST /api/trainer/equipment/enhance  { domain, equipmentId } → raise one owned
                              piece's enhance level by 1, paying its gold (+
                              optional material) cost exactly once; returns
                              { gold, inventory }
POST /api/trainer/runes/socket       { runeId, monsterId: number|null } →
                              socket one owned rune onto a monster, or
                              unsocket it (monsterId: null); 409 when broken
                              ("repair it first") or the monster has no free
                              rune slots left; returns the refreshed
                              inventory (Phase 7.3; same grouping reasoning
                              as /api/trainer/equipment/*)
POST /api/trainer/runes/repair       { runeId } → fully recharge one owned
                              rune and clear `broken`, paying its def's flat
                              `repair_gold` exactly once; 409 "rune doesn't
                              need repair" when already full and unbroken;
                              returns { gold, inventory }
GET  /api/trainer/summon      the enabled Summon Hall banners (Phase 7.4
                              step A; ROADMAP drafted top-level /api/summon,
                              grouped here instead, same reasoning as
                              /api/trainer/inventory)
POST /api/trainer/summon      { summonId } → pull one banner: pays its cost
                              (gold and/or items, claim-first-then-pay per
                              leg), rolls a species from its pool with a
                              freshly minted stored seed, mints the monster,
                              and writes an audit row; returns { summonId,
                              seed, monster, gold, inventory }; 404 for an
                              unknown or disabled banner, 409 "check gold or
                              materials" when a cost leg can't be paid

# battle domain — api/battle/[...route].js
POST /api/battle/match        { mode? } → create match session ('free', default:
                              server picks a random defender + seed | 'pvp':
                              matched against another trainer's defense formation)
POST /api/battle/resolve      { matchId, playerOrder } → persisted result + events;
                              a pvp match's result also carries
                              pvp: { yourDelta, theirDelta, yourRating };
                              after the resolve claim wins, also settles rune
                              durability from the engine's runeUse tally
                              against the ATTACKER's socketed runes only
                              (Phase 7.3) — not itself part of the response
GET  /api/battle/formation    the trainer's saved defense formation, or null
POST /api/battle/formation    { monsterIds } → save (upsert) the defense
                              formation as exactly 3 owned monster ids
GET  /api/battle/ladder       { season, top, me } → lazily rolls the season
                              (close+payout / open) before reading it
GET  /api/battle/tournaments  { tournaments } → every tournament (any status),
                              each with a live entrant count and the CALLER's
                              own entry summary ({enteredAt, monsterIds,
                              feePaid}) or null (Phase 9.2)
POST /api/battle/tournament/register  { tournamentId, monsterIds:number[3] } →
                              { entry } register exactly 3 owned, free
                              monsters while the registration window is open:
                              claim-first-then-pay entry fee, party busy-claim
                              (busy_kind='tournament'), toLane() team freeze,
                              LIFO compensation on any failure; 409 "not
                              enough gold for the entry fee" / "a monster is
                              busy or not yours" / "already registered for
                              this tournament" / "registration is not open"
POST /api/battle/tournament/withdraw  { tournamentId } → { withdrawn:true }
                              give up a registration while still open:
                              guarded entry delete + lock release + fee
                              refund

# activities domain — api/activities.js (plain file: one route today)
GET  /api/activities          the farm: jobs + monsters + running assignments
                              (settles finished ones first — lazy time)
POST /api/activities          start work/training { monsterId, jobId }

# admin domain — api/admin/[...route].js
# every call re-checks trainers.is_admin (403)
GET    /api/admin/master      all 8 master tables (classes, skills, species,
                              jobs, item_defs, equipment_defs, rune_defs,
                              summon_defs — the last gained a pullCount
                              usage badge, Phase 7.4) + engine enum
                              registries (now incl. item kinds, equipment
                              domains/slots, summonCostTypes)
POST   /api/admin/{classes,skills,species,jobs,items,equipment,runes,summons}
                              validated upsert
DELETE /api/admin/{classes,skills,species,jobs,items,equipment,runes,summons}
                              guarded delete (409 in use)
POST   /api/admin/grant       { trainerId?, kind, defId, qty? } → grant an
                              item/equipment/rune to a trainer (defaults to
                              the caller); an admin-only shortcut for seeding
                              test data — the Summon Hall
                              (`/api/trainer/summon`, Phase 7.4 step A) is
                              now the player-facing acquisition path
GET  /api/admin/tournaments   { tournaments } → every tournament (any status)
                              with a live entrant count (Phase 9.2)
POST /api/admin/tournaments   { name, description?, entryFee?, regStartsAt,
                              regEndsAt, rewards } → { tournament } create
                              one; status always starts 'scheduled'
POST /api/admin/tournaments/cancel  { id } → { tournament } cancel at any
                              non-completed status: releases every entrant's
                              locks and refunds entry fees (idempotent,
                              compensating), keeps the row visible in history

# adventure domain — api/adventure/[...route].js (Phase 7.4 step B; the 6th
# domain, anticipated by the "not yet built" note this section used to carry)
GET  /api/adventure/state     { adventures, session } → the enabled routes
                              (id/name/description only — a route's `config`
                              is server balance data, never shipped) plus the
                              trainer's current session view, or null; lazily
                              expires a stale (past ends_at) session first
POST /api/adventure/start     { adventureId, monsterIds:number[3] } → lock
                              the party (busy_kind='adventure', 24h),
                              generate the map from a freshly minted stored
                              seed, freeze both into a new session; 409
                              "already on an adventure" / "a monster is busy
                              or not yours", 404 unknown/disabled route
POST /api/adventure/move      { choice:number } → resolve the CURRENT step's
                              chosen option exactly once (claim-guarded, same
                              shape as battle/resolve's applyOrder): chest/
                              gather grant loot via the inventory repo,
                              battle auto-resolves through resolveBattle()
                              directly (seeded from deriveNodeSeed(session.seed,
                              position) — no `matches` row) and settles the
                              party's rune durability; a lost/drawn battle
                              fails the run, the final step's win completes
                              it, either way releasing the party; returns
                              { session, node } (node carries the battle
                              event log, if any — never persisted to the row)
POST /api/adventure/abandon   {} → give up the active run early (guarded
                              'active'→'abandoned'), releases the party;
                              404 if no active session

# not yet built (future domains, still under the 12-function cap)
GET  /api/market/browse       search/filter listings (kind, text, price
                              range, paging) — not the bare /api/market: a
                              Vercel catch-all [...route].js can't match its
                              own bare prefix (api/activities.js precedent)
POST /api/market/list         { kind, refId, qty?, price } → escrow the
                              good, create a listing
POST /api/market/buy          { listingId } → transfer gold + good exactly
                              once, guarded by status='open' and balance
POST /api/market/cancel       { listingId } → close an open listing, return
                              the escrowed good to the seller
POST /api/trainer/inventory/sell  { kind:'item'|'equipment'|'rune',
                              defId?/id?, qty? } → instant-sell straight to
                              the system at the def's fixed `sell_gold`
                              price (grouped under the trainer domain, not
                              a new function); returns { gold, inventory }
```

Handler contract: authenticate → load DB state → validate the client's
*choice* against it → act → return the new state + any event log. Any value
a handler trusts from the body is a bug.
