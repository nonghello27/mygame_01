# Roadmap — what to build, in what order, and why that order

Phases are sequenced so every phase ships something playable and nothing has
to be rebuilt later. Each phase lists **Start here** (the first concrete task
to hand an agent) and **Done when** (the acceptance test). Don't start a
phase before the previous one's "Done when" holds — the ordering encodes real
dependencies (you can't own monsters without accounts; you can't reward PVP
without an economy).

## Phase 0 — Foundations ✅ DONE (2026-07-02)

Locked in the practices everything else relies on.

- ✅ `db/schema.sql` → `db/migrations/001_init.sql` + `db/migrate.mjs` runner
  (tracked in a `schema_migrations` table; `npm run db:migrate`;
  `seed.mjs` migrates first, then seeds).
- ✅ `shared/engine/resolve.js` (moved from `src/core/`; `api/battle.js`
  updated) — the client/server-shared zone is now explicit.
- ✅ `npm test` (`node --test`): golden-log tests in `tests/resolve.test.mjs`
  against `tests/golden/*.json` (fixtures in `tests/fixtures.mjs`,
  regenerate intentionally via `node tests/golden/regen.mjs`).
- ✅ Seeded PRNG `shared/engine/rng.js` (mulberry32 + int/chance/pick),
  tested incl. a golden sequence — ready for engine v2 and match seeds.

## Phase 1 — Accounts & trainers ✅ CODE COMPLETE (2026-07-02)

- ✅ **Firebase Auth** (Google popup + email/password with register &
  password reset; more providers = console toggle) →
  `POST /api/auth/login` verifies the Firebase ID token server-side (RS256
  vs Google certs, ARCHITECTURE §7) → upsert `trainers` (`002_trainers.sql`,
  applied; keyed by Firebase uid) → HttpOnly HMAC session cookie
  (`server/auth.js`; `trainer_id` is only ever read from the session).
- ✅ `GET /api/me`, `POST /api/auth/logout`; full landing/login screen —
  the game stays hidden until the session is confirmed — plus the header
  profile bar (name/gold/exp) (`src/ui/auth.js`).
- ✅ `server/` established: `server/auth.js`, `server/repos/trainers.js`;
  session tests in `tests/auth-session.test.mjs`.

**Remaining (operator step):** in Firebase console enable the **Google**
sign-in method and add the Vercel domain under Authorized domains; set
`FIREBASE_PROJECT_ID` + `SESSION_SECRET` (+ `DATABASE_URL`) in Vercel env
vars (already in local `.env`); then verify two Google accounts see two
different trainers.

## Phase 2 — Owned monsters & tamper-proof matches ✅ DONE (2026-07-02)

Turned "two hardcoded armies" into "your monsters vs a server-picked enemy".

- ✅ `003_monsters_matches.sql`: `monster_species` (master, seeded from the
  old roster data; army A = starter species), `monsters` (instances),
  `matches` (seed + frozen attacker/defender snapshots + persisted result);
  the obsolete `units` table dropped.
- ✅ Starter monsters granted lazily on a trainer's first match.
- ✅ `POST /api/match` (auth required; server picks + freezes the enemy team
  AND its lane order, mints the seed) and `POST /api/battle
  { matchId, playerOrder }` (permutation-validated, resolves exactly once,
  result persisted, replays rejected 409). `api/rosters.js` retired.
- ✅ Client: your army comes from your monsters; the enemy side is
  drag-locked; "New Opponent" opens a fresh match; battles require login.
- Deferred by design: `formations`/`formation_slots` tables and a dedicated
  collection screen belong to Phase 6 (defense formations for PVP), where
  they're first needed — the board itself is the formation editor until then.

**Done when (verified):** a logged-in player fights their own monsters vs a
server-chosen enemy; illegal orders and replayed matchIds are rejected;
results are rows in `matches`.

## Phase 3 — Battle engine v2 ✅ DONE (2026-07-02)

ARCHITECTURE §5 implemented in `shared/engine/` + `shared/rules/`, test-first.

- ✅ Readiness (ATB) loop: gauges fill by effective SPD, threshold subtract
  with overflow carry, seeded-rng tie-breaks; the stored match seed now
  drives every roll. TURN_CAP → draw.
- ✅ Attributes STR/AGI/VIT/INT/DEX → derived stats (`shared/rules/
  formulas.js`, computed ONCE in the match snapshot), ATK/MATK min–max
  rolls, crit/evade/accuracy, element chart, melee/range + targeting
  registry + 25% front-line penalty for range.
- ✅ Data-driven skills (master `skills` + `species_skills` + `monster_skills`
  tables, 4 slots, ultimates start on cooldown) and statuses (stun, freeze,
  burn, poison, atk up/down) interpreted from JSONB by a closed op set.
- ✅ Replayer handles the new events (turn/skill/miss/dot/status/heal/buff/
  skip/draw); cards show element + attack range.
- Design note: the planned "v1 parity gate" was dropped deliberately — a
  speed-gauge system cannot reproduce v1's strict alternating duels (faster
  units now act more often, which is the point). v1 was retired outright;
  v2 has its own golden suite (`battle-skirmish`, `battle-plain`) plus
  seed-independent behavior tests (`tests/engine.test.mjs`).
- Not yet: DEF/mitigation stat, trainer skills in battle (Phase 6), monster
  growth feeding the attributes (Phase 4).

**Done when (verified):** fixture battles with skills/statuses produce stable
golden logs; a real match resolves through the full pipeline (passive buffs,
skills, misses, burns, stuns) and replays in the client.

## Phase 4 — Economy: work & training ✅ DONE (2026-07-02)

The first out-of-battle loop; gold is now a real currency.

- ✅ `005_economy.sql`: `job_defs` (master, seeded from `src/data/jobs.js`) +
  `activities` (instance rows with persisted outcomes) + `monsters.busy_until`
  / `busy_kind` locking. Nine jobs: four work tiers (1m–2h) and one training
  job per attribute (+1 STR/AGI/VIT/INT/DEX).
- ✅ Lazy time, for real (ARCHITECTURE §6): no cron — `settleActivities()`
  runs on every authenticated read (`GET /api/me`, `/api/activities`, match
  creation). Each payout is ONE atomic claim+pay SQL statement (CTE), so a
  racing read settles an activity exactly once; the busy clear is guarded so
  it can't wipe a newer job's lock.
- ✅ `GET/POST /api/activities` — the client sends `{ monsterId, jobId }`,
  two ids; durations/rewards/gains are read from `job_defs`. The busy lock is
  taken atomically (owned + currently free, first caller wins) and the
  activity shares the lock's exact timestamp.
- ✅ Busy monsters are excluded at match creation (409 when fewer than 3 are
  free); training gains land in `monsters` attrs and flow into the next match
  snapshot via `deriveStats()` — growth finally feeds the engine.
- ✅ Farm/HQ panel (`src/ui/farm.js`, toggled from the controls): assign via
  job picker, live countdowns, collect on return; header gold/exp chips
  update from settlement.

**Done when (verified):** monster sent to work; while busy it can't take a
second job (409) and no match can open (409); after the duration a plain
`GET /api/me` pays +gold/+exp exactly once; training raised STR by 1 and the
monster was freed. Full E2E run against the live DB.

## Phase 5 — Admin console: master-data management ✅ CODE COMPLETE (2026-07-02)

Operate the game's content from inside the game. An admin-only area (menu
entry → sub-menu per table) to add/edit/delete every master table and the
relations between them, replacing hand-editing `src/data/*.js` + re-seeding
as the only content workflow. Anything with an image (sprites, emoji
portraits) is shown as an image, not as an id string.

- `006_admin.sql`: `trainers.is_admin`; accounts listed in the
  `ADMIN_EMAILS` env var are promoted at login (promotion only — demotion is
  a manual SQL statement, so a bad env edit can't lock everyone out).
- `api/admin/*`: one GET returning all master data + the engine's enum
  registries (elements, targeting rules, statuses, skill slots) so the UI's
  dropdowns can never drift from the engine; upsert/delete per table for
  `classes`, `skills`, `monster_species` (+ its `species_skills` loadout),
  `job_defs`. Every handler re-checks `is_admin` server-side (403).
- Validation lives server-side (`server/services/`): enum membership, skill
  `data` / job `rewards` grammar, loadout slot types (0–1 passive, 2 normal,
  3 ultimate). Deletes are guarded: a row referenced by instances (monsters,
  activities, loadouts) answers 409 with what blocks it.
- Admin panel (`src/ui/admin.js`): ⚙ button (admins only) → tabs Classes |
  Skills | Species | Jobs | Sprites. Species editor wires the relations:
  class dropdown, per-slot skill dropdowns filtered by slot type, sprite
  picker with live image previews (chroma-keyed portraits / sheet
  thumbnails / emoji fallback). Sprites tab is a read-only gallery showing
  each sheet, its metadata, and which species use it.
- Caveat (documented in the panel): `npm run db:seed` upserts from
  `src/data/*.js` and will overwrite admin edits to rows that share ids —
  the DB is the source of truth once you edit it live.

**Remaining (operator step):** set `ADMIN_EMAILS` in `.env` (done locally)
and in Vercel env vars; log in with that account once so the flag is granted.

**Done when:** an admin account sees the console, a non-admin gets 403s;
a new species created entirely in the UI (class, skills, sprite) appears in
the next match; deleting an in-use skill is refused with a clear message.

## Phase 6 — PVP ladder & trainer progression ✅ CODE COMPLETE (2026-07-03)

- ✅ `007_pvp.sql` + `008_pvp_guards.sql`: master tables `expertises` +
  `trainer_skill_defs` (seeded from `src/data/expertises.js`); instance table
  `trainer_skills` (2 fixed learn slots); `formations` + `formation_slots`
  (one `purpose='defense'` formation per trainer, 3 slots); `seasons` +
  `rank_entries` (rating/wins/losses/draws/reward, ranked by
  `rank_entries_season_rating_idx`); `matches` grows `kind`
  (`'free'|'pvp'`), `defender_id`, and `attacker_trainer`/`defender_trainer`
  (frozen trainer-skill snapshots); a partial unique index enforces at most
  one `status='active'` season at the DB layer.
- ✅ Engine triggers implemented for real (`shared/engine/resolve.js`):
  `resolveBattle` takes a 4th `trainers` arg (`{a:{skills},b:{skills}}`),
  fires `battle_start` before unit passives and `after_ally_turns` once every
  currently-alive unit on a side has acted since it last fired, both through
  the same closed op set (`perm_stat`/`heal`/`apply_status`) monster skills
  use — a `tskill` event marks each firing for the replayer. A free match
  passes empty trainer skills, so behavior there is unchanged (golden logs
  intact).
- ✅ Progression (`server/services/progression.js` + `server/repos/
  progression.js`, `GET/POST /api/progression`, `POST /api/trainer-skills`):
  pick an expertise at `EXPERTISE_UNLOCK_EXP` (10) trainer exp
  (`shared/rules/progression.js`); learn/clear either of 2 skill slots,
  re-validated server-side against fresh DB state every call
  (`validateLearnChoice`). Switching to a *different* expertise wipes both
  learned slots in the same atomic statement (`setExpertise`'s
  update+conditional-delete CTE) — the client (`src/ui/trainer.js`) makes the
  player confirm that cost with an inline two-step click.
- ✅ Defense formations (`server/services/pvp.js` `saveDefense`/`getDefense`,
  `GET/POST /api/formation`): exactly 3 owned, distinct monster ids in lane
  order; busy monsters are allowed (defense is passive, never blocks work).
- ✅ Lazy season rollover (`ensureSeason`, same read-then-claim shape as
  `settleActivities`): no active season → insert one (008's unique index
  makes a lost insert race a clean re-read); active but past `ends_at` →
  claim-guarded close (`claimSeasonClose`) pays out
  (`payoutSeason`'s gold tiers mirror `shared/rules/pvp.js
  seasonRewardGold`, idempotent via `reward IS NULL`) and opens the next
  season, in a bounded retry loop. Runs at the top of every PVP read/write —
  `GET /api/ladder`, match creation, defense saves.
- ✅ Matchmaking (`createPvpMatch`): attacker's own available roster (same
  selection as free play) vs. a defender drawn from a small pool of other
  trainers with a *complete* defense formation, ordered by rating proximity
  to the attacker (`listPvpCandidates`); both sides' derived-stat lanes AND
  trainer-skill snapshots are frozen into the match row exactly like free
  matches freeze enemy lanes — tamper-proof and replayable.
- ✅ Elo applied once at resolve (`server/services/matches.js
  resolveMatch`): for `kind='pvp'` matches, `eloDelta` (`shared/rules/
  pvp.js`, K=32) computes both sides' deltas from each side's *current*
  rank-entry rating, attaches `{yourDelta, theirDelta, yourRating}` onto the
  persisted result as `pvp`, and — only after `claimResolve` wins the
  once-only claim, so a losing/replayed resolve can't double-apply — writes
  rating + win/loss/draw counters for both trainers atomically in one
  statement (`applyRatingResult`).
- ✅ Arena panel (`src/ui/pvp.js`, ladder + defense-formation editor) and
  Trainer panel (`src/ui/trainer.js`, expertise + skill slots) — pure
  presentation over `/api/ladder`, `/api/formation`, `/api/progression`,
  `/api/trainer-skills`; "Ranked Battle" opens a `mode:"pvp"` match through
  the same setup-board/`Start Battle` flow "New Opponent" already uses.

**Remaining (operator step):** verify the phase's "Done when" with two real
accounts in a browser — pick expertises, learn skills, save defense
formations, attack each other, and watch the ladder move.

**Done when:** two real accounts can attack each other's defense teams and
climb a visible ladder.

## Phase 7 — Acquisition & itemization

Too big for one shot — executed as five sub-phases, each independently
shippable. Order rationale: schema + inventory first (everything else
references it), equipment into the engine next (smallest engine touch), runes
after (adds post-battle durability settlement), then the acquisition loops,
and trading — the one place that needs real transactional care — last.

Cross-cutting rules for all five sub-phases:

- **No player-facing acquisition exists until 7.4**, so 7.1's grant service
  must be admin-exposed — that's how 7.1–7.3 get tested live, and where 7.2's
  enhancement materials come from until adventure ships.
- New master tables follow the Phase 5 workflow **in the same sub-phase that
  creates them**: seed file in `src/data/`, admin-console tab, server-side
  validation, guarded deletes, and `/api/admin/master` returns them.
- Item/rune/equipment effects reuse the skills JSONB grammar and the closed
  op set in `shared/rules/`. A genuinely new mechanic = one new op/trigger in
  the registry — never an engine branch for one item.

### Phase 7.1 — Item schema & inventory ✅ CODE COMPLETE (2026-07-03)

- ✅ `009_items.sql`: master `item_defs`, `equipment_defs` (domain
  `'trainer'|'monster'`, slot, effects JSONB, enhance cost curve),
  `rune_defs` (effects JSONB, max_charges); instance `items` (qty stacks,
  `UNIQUE(trainer_id, def_id)`), `trainer_equipment` / `monster_equipment`
  (enhance_level, equipped slot / monster_id nullable), `runes`
  (charges_left, broken, monster_id nullable) — per ARCHITECTURE §4. Also
  adds `monster_species.rune_slots` (DEFAULT 1): it's in ARCHITECTURE's draft
  but was never migrated, 7.3 depends on it, and the admin species editor
  now exposes it.
- ✅ Seed files `src/data/items.js` / `equipment.js` / `runes.js` (3 items,
  6 equipment rows across both domains/slots, 3 runes); `db/seed.mjs` upserts
  all three plus `monster_species.rune_slots`.
- ✅ `adminValidate.js` grammar: `validateItem`/`validateEquipment`/
  `validateRune`, and a shared `validateBattleStartEffects()` extracted from
  the skill-passive check — skills keep their exact pre-7.1 grammar (no
  `perLevel`), equipment/runes get `perLevel` for 7.2's enhancement math.
  `validateSpecies` gained `runeSlots` (0–5, default 1).
- ✅ Admin CRUD (`server/repos|services|routes/admin.js`): upsert + guarded
  409 deletes for all three tables; `masterState()`/`GET /api/admin/master`
  now returns `itemDefs`/`equipmentDefs`/`runeDefs` + the new enums
  (`itemKinds`, `equipDomains`, `equipSlots`).
- ✅ `server/services/inventory.js` + `server/repos/inventory.js`: grant/consume
  as atomic claim-style statements (the `settleActivities` pattern) —
  `consumeItem` is ready for 7.2 to call.
- ✅ `GET /api/trainer/inventory` — items + equipment (bag + equipped) + runes
  in one call. (ROADMAP originally drafted `/api/inventory`; grouped under
  the trainer domain instead, same reasoning as the `/api/me` →
  `/api/trainer/me` rename — a new top-level `api/` file costs a serverless
  function.)
- ✅ `POST /api/admin/grant` — the only acquisition source until 7.4; grants
  to the calling admin (or a named trainer) and re-checks `is_admin`.
- ✅ UI: 🎒 Inventory panel (`src/ui/inventory.js`) — tabs Items | Equipment |
  Runes, pure display over the one read; admin console gained matching
  Items | Equipment | Runes tabs (JSON-textarea effects editor, mirroring
  the Skills tab) plus a per-def "Grant to me" control, and the Species
  editor gained a Rune slots field.
- ✅ Tests: `adminValidate` cases for all three validators + the
  perLevel-stays-skill-only regression + species `runeSlots` bounds;
  `tests/items.test.mjs` guards the three seed files' grammar/uniqueness the
  way `tests/jobs.test.mjs` guards jobs. Golden logs untouched (no engine
  code changed).

**Remaining (operator step):** verify the phase's "Done when" in a browser
with an admin account — grant one of each kind (item/equipment/rune), confirm
all three appear correctly in the 🎒 Inventory panel's three tabs, and
exercise a guarded delete (edit a def an owned row references, confirm 409).

**Done when:** goods granted via the admin endpoint appear in all three tabs;
admin CRUD works on the three new master tables; deleting a def referenced by
an instance row answers 409.

### Phase 7.2 — Equipment: equip, enhance, engine integration ✅ CODE COMPLETE (2026-07-03)

- ✅ `server/repos/equipment.js` + `server/services/equipment.js`: equip/
  unequip for both domains (clear-then-seat in one statement — a monster/
  trainer holds at most one piece per def slot, so equipping into an
  occupied slot auto-returns the previous piece to the bag rather than
  requiring a pre-unequip), and enhance as a claim-first-then-pay sequence
  (the atomic `enhance_level` UPDATE's WHERE clause is the whole gate —
  right instance/owner/level/cap — then gold debit, then optional material
  spend; a losing leg after a won claim triggers a compensating
  revert/refund rather than leaving a free upgrade in place, same shape as
  `settleActivities`'s claim pattern).
- ✅ `POST /api/trainer/equipment/equip` `{ domain:'trainer'|'monster',
  equipmentId, monsterId?, equip? }` and `POST /api/trainer/equipment/enhance`
  `{ domain, equipmentId }` — both return the refreshed inventory read (enhance
  also returns `gold`). **Deviation from this section's original draft:**
  grouped under the `trainer` domain (`/api/trainer/equipment/equip|enhance`)
  rather than a new top-level `/api/equipment/*` domain — same
  serverless-function-count reasoning as `/api/trainer/inventory` (Phase 7.1)
  and the `/api/me` → `/api/trainer/me` rename.
- ✅ Enhance grammar gained an optional `material: { itemId, qtyPerLevel }`
  cost on top of `goldPerLevel` (drafted in 7.1's schema note, wired here);
  `consumeItem` from 7.1 is the material spend.
- ✅ Engine integration: `deriveStats()` stays pure — `toLane()` in
  `server/services/matches.js` now takes a 3rd `equipment` argument and
  gathers each monster's *equipped* monster-domain gear
  (`listEquippedMonsterEquipment`) into the frozen lane snapshot; free
  matches don't carry trainer-domain gear (parity with trainer skills —
  those are PVP-only auras), so existing golden logs are untouched (no
  fixture carries equipment).
- ✅ `resolveBattle`'s trainer arg widened from a bare skills array to
  `{skills, equipment}` (trainer-domain gear, PVP-only, frozen into
  `attacker_trainer`/`defender_trainer` the same way trainer skills are);
  `normalizeTrainer()` reads pre-deploy matches' old bare-array shape as
  `{skills: [...], equipment: []}` so an in-flight match across the deploy
  boundary resolves exactly as it would have before.
- ✅ `battle_start` firing order implemented per GAME_DESIGN §7: trainer
  skills → unit passives → **monster-domain equipment** (per-unit, same
  op set as passives) → **trainer-domain equipment** (side-wide aura, no
  target grammar) → runes join this order in 7.3.
- ✅ UI: the 🎒 Inventory panel's Equipment tab (`src/ui/inventory.js`) gained
  equip/unequip controls (a monster picker for monster-domain gear, a plain
  toggle for trainer-domain gear — equipping shows the previous slot
  occupant returning to the bag on the next refresh) and an enhance button
  labeled with its gold (+ material, when the curve declares one) cost, or
  "MAX" at the curve's cap; `src/services/content.js` gained
  `equipMonsterEquipment`/`equipTrainerEquipment`/`enhanceEquipment` as the
  I/O boundary (ui/ never calls fetch directly). Errors surface at the panel
  level, same pattern as the Arena panel's defense-save button; enhance also
  refreshes the header's gold chip via `fetchMe()`/`showProfile()`.
- ✅ Tests: `tests/equipment-engine.test.mjs` — the `battle_start` firing
  order (trainer skills → passives → monster equipment → trainer equipment,
  asserted via event order), `perLevel`/enhance-level scaling observed
  through HP values, trainer-domain equipment as a side-wide aura (every
  unit on the owning side, none on the other), the old bare-array
  `trainers` arg still working (back-compat), and absent-vs-empty
  `equipment` fields producing an identical event log (determinism).
  `adminValidate` gained cases for the `enhance.material` grammar (optional,
  round-trips, rejects bad shapes); `items.test.mjs` gained a referential
  guard that every seed piece's `enhance.material.itemId` names a real
  `item_defs` row. Golden logs unchanged (no fixture carries equipment).

**Remaining (operator step):** verify in a browser with an admin-granted
piece — equip a monster-domain item, start a free match, and see the buff
reflected in that match's derived stats; unequip and confirm the next match
reverts it; enhance a piece and confirm gold (and material, if any) debits
exactly once per click, and the button shows "MAX" at the level cap.

**Done when:** equipping visibly changes the next match's derived stats and
unequipping reverts them; enhance pays exactly once; golden logs unchanged.

### Phase 7.3 — Runes: socket, consume, break, repair

- `POST /api/runes/socket` `{ runeId, monsterId | null }` — validates
  ownership, species `rune_slots`, and `broken = false`.
- Engine: rune modifiers are data interpreted by the closed op set (e.g. a
  targeting override during target selection). The engine is pure — it never
  writes charge state; it **reports** consumption: a `rune` event in the log
  per trigger + a per-rune-instance tally on the result.
- `resolveMatch()` settles durability after `claimResolve` wins (same
  once-only guard as Elo): decrement `charges_left` by instance id from the
  tally, clamp at 0; at 0 set `broken = true` and unsocket. Settlement must
  tolerate the instance having been repaired/moved since the snapshot froze
  (update by id, skip missing).
- `POST /api/runes/repair` — gold cost, one atomic debit+restore statement.
- Design decision to make first: whose runes decay in PVP. Recommendation:
  only the attacker's — a defender shouldn't pay durability while offline.

**Done when:** a socketed rune changes targeting in the event log;
`charges_left` drops by exactly the count of `rune` events; the rune breaks
at 0 and is auto-unsocketed; repair restores charges.

### Phase 7.4 — Acquisition: Summon Hall, then Adventure

Two loops in one sub-phase — ship Summon first (it's small, gives gold its
first sink, and finally makes 7.1–7.3 testable without the admin grant).

- Summon: audit table `summons` (trainer, cost, seed, result);
  `POST /api/summon` — validate the cost (gold and/or items like summoning
  scrolls) against DB state → one atomic debit → **seeded** weighted roll
  (stored seed ⇒ auditable, per the determinism principle) → mint the monster
  instance. Quest-style summon requirements go through a pluggable checker
  interface from day one — the photo-quest scorer (Phase 8 ⚠) plugs in later.
- Adventure: `adventure_sessions` (map JSONB, party, position, seed, state);
  `POST /api/adventure/start` locks the party (`busy_kind = 'adventure'` —
  the value has been reserved since 005) and generates the map from a stored
  seed; `POST /api/adventure/move` validates the step server-side and
  resolves the node — auto-battle via `resolveBattle()`, loot chest →
  inventory grant, gather node → materials; finishing/abandoning frees the
  party through the existing guarded busy-clear.

**Done when:** a summon mints a monster exactly once for its cost with a
replayable seed; a full adventure run yields loot in the inventory (and any
catch in the roster) and the party unlocks correctly, including on abandon.

### Phase 7.5 — Marketplace

- `marketplace_listings` (seller, kind `item|equipment|rune|monster`, ref id,
  qty, price, status `open|sold|cancelled`). Listing **escrows** the good —
  removed from usable inventory at list time; cancel returns it.
- Monsters are listable only when free of obligations: not busy, not in the
  defense formation, equipment and runes stripped first.
- `POST /api/market/list` / `buy` / `cancel`; `GET /api/market` with
  search/filter.
- Concurrency: prefer the codebase's one-statement claim CTE (mark sold +
  debit buyer + credit seller + transfer ownership, guarded by
  `status = 'open'` and `gold >= price`) — it's the same exactly-once shape
  as activity settlement. Caveat: the Neon **HTTP driver can't run
  interactive transactions**; if a flow truly needs multi-statement
  `SELECT FOR UPDATE`, that endpoint must use the websocket `Pool` client.
- UI: catalog screen with search/filter + a "my listings" management view.

**Done when:** with two real accounts, list → buy transfers gold and goods
exactly once; a concurrent second buy answers 409; cancel restores the
escrowed good.

## Phase 8 — Social & events (later)

Guilds + GVG, tournaments (server-resolved brackets), messages/notifications,
and — last, once there's an audience and moderation plan — the **photo quest**
(image-scored summon quest, GAME_DESIGN §6.5 ⚠).

## Standing rules while executing

- Every phase updates docs/ + CLAUDE.md if it changes an interface.
- Engine changes always come with golden-log tests.
- Never widen an API to accept a value the server could look up itself.
