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

## Phase 7 — Acquisition & itemization ✅ CODE COMPLETE (2026-07-04)

Too big for one shot — executed as four sub-phases, each independently
shippable. Order rationale: schema + inventory first (everything else
references it), equipment into the engine next (smallest engine touch), runes
after (adds post-battle durability settlement), then the acquisition loops.
(The marketplace was originally staged here as sub-phase 7.5; it's a full
phase's worth of transactional care and unblocks nothing else in Phase 7, so
it was promoted to its own **Phase 8** below — 2026-07-04 renumbering.)

Cross-cutting rules for all sub-phases:

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

### Phase 7.3 — Runes: socket, consume, break, repair ✅ CODE COMPLETE (2026-07-03)

Same itemization shape as 7.1/7.2: master/instance rows, the closed
skill-passive grammar reused (plus one rune-only trigger), gold-gated
server-authoritative use-cases, and a pure UI layer over one refreshed read.

- ✅ `POST /api/trainer/runes/socket` `{ runeId, monsterId | null }` and
  `POST /api/trainer/runes/repair` `{ runeId }` — grouped under the
  `trainer` domain rather than a new top-level `/api/runes/*` domain, same
  serverless-function-count precedent as `/api/trainer/inventory` (7.1) and
  `/api/trainer/equipment/*` (7.2). Socket validates ownership, `broken =
  false`, and the monster's species `rune_slots` capacity (one guarded
  UPDATE re-checks all three atomically, `server/repos/runes.js`
  `socketRune`); 409 "rune is broken — repair it first" / "no free rune
  slots on that monster". Repair is claim-first-then-pay (same shape as
  equipment's enhance): a guarded UPDATE re-checks the caller's
  `charges_left`/`broken` snapshot AND enough gold in one statement, then
  `debitGold`; a losing pay leg after a won claim reverts rather than
  leaving a free repair in place. Both return the refreshed inventory
  (`getInventory`); repair also returns `{gold}`. Repair is allowed
  whenever the rune is drained-but-unbroken too, not only once actually
  broken — "needs repair" means `charges_left < max_charges OR broken`.
- ✅ Rune grammar: reuses the exact skill-passive `battle_start`/`perm_stat`
  shape (with `perLevel`, like equipment), OR a rune-only trigger —
  `{ when: "target_select", op: "override_targeting", rule }` — validated by
  `validateRuneEffects` (`server/services/adminValidate.js`); equipment and
  skills never get the override shape. `src/data/runes.js`'s `rn_hunter`
  seeds the targeting-override case (`rule: "lowest_hp_pct"`); the other
  three seed runes exercise `battle_start`/`perm_stat`.
- ✅ Engine (`shared/engine/resolve.js`): socketed runes join the
  `battle_start` firing order last (trainer skills → passives → monster
  equipment → trainer equipment → **runes**), and a target-selecting rune
  can override that turn's targeting rule. **One trigger = one charge = one
  `rune` event** (`{t:"rune", side, idx, rune:<defId>, name}`), regardless of
  how many `battle_start` effects a single rune def carries — `fireRune()`
  decrements a LOCAL, mutable copy of the frozen `chargesLeft` the lane
  snapshot carried in and goes silent (no event, next rune/normal targeting
  tried instead) once that copy hits 0. The engine stays pure: it never
  writes DB state, it only **reports** consumption via the returned
  `runeUse: {a:Object<instanceId,count>, b:Object<instanceId,count>}` tally
  (keyed by the owned rune row's id, not the def id) for the caller to
  settle.
- ✅ Durability settlement (`server/services/matches.js` `resolveMatch`):
  after `claimResolve` wins the once-only claim (same guard Elo rides),
  `applyRuneWear` spends `runeUse.a` against the attacker's rune rows —
  **attacker-side only**. Locked design decision (was an open question in
  this section's draft): a PVP defender's saved formation is snapshotted
  and fought while they're offline, so their runes never decay from a match
  they didn't actively play; only `runeUse.a` (the side that actually holds
  the acting client's own gauge/turns in every match kind — free or pvp) is
  ever applied. Breaking (`charges_left` hits 0) and auto-unsocketing
  (`monster_id -> NULL`) happen in the SAME guarded UPDATE as the decrement,
  by rune id — never by the frozen snapshot state — so an instance that was
  repaired or resocketed since the match snapshot froze still wears exactly
  as if it had sat still, and one that's since been reassigned/deleted
  entirely (no matching row) is silently skipped, not an error.
- ✅ UI: the 🎒 Inventory panel's Runes tab (`src/ui/inventory.js`) gained
  socket/unsocket controls (a monster picker + Socket button, hidden while
  broken since the server 409s anyway; Unsocket when already socketed) and a
  Repair button labeled with the def's flat `repairGold` cost, shown
  whenever the rune is broken or short of full charges; each rune row now
  shows `chargesLeft/maxCharges`, its level badge, a "BROKEN" badge when
  broken, and "In bag"/"Socketed: `<monster name>`" using the same roster
  source the Equipment tab's monster picker uses. `src/services/content.js`
  gained `socketRune`/`repairRune` as the I/O boundary (ui/ never calls
  fetch directly), mirroring the 7.2 equipment helpers exactly. The
  replayer (`src/core/battle.js`) gained a `rune` event handler — a
  synchronous log line (`"<unit>'s <rune name> flares!"`), same shape as
  `replayBuff`/`replayTrainerSkill`: no math, no state, purely narrating
  what the server already resolved.
- ✅ Tests: `tests/items.test.mjs` gained the rune-seed grammar coverage
  (both effect shapes present, ids unique); the new `tests/rune-engine.test.mjs`
  covers the `battle_start` firing order landing runes last (after
  equipment), the targeting override actually redirecting a front-locked
  attacker, charge exhaustion (reverts to normal targeting once the local
  copy hits 0), side separation (`runeUse.b` never receives a side-a
  instance id), and determinism/back-compat (absent vs. empty `runes`
  fields produce an identical result). **Golden logs regenerated for one
  reason only:** the
  additive, always-empty `runeUse: {a:{}, b:{}}` field now present on every
  result envelope (no fixture carries runes, so every existing event array
  is byte-identical — verified, not assumed).

**Remaining (operator step):** verify the phase's "Done when" in a browser
with an admin account — grant `rn_hunter` to yourself, socket it onto a
monster, start a match, and confirm its `target_select` override actually
redirects that monster's attacks (event log) alongside `rune` events; watch
`charges_left` drop by exactly the count of those `rune` events across a few
matches; drain a rune to 0 and confirm it breaks and auto-unsockets; repair
it and confirm charges are restored and it can be socketed again.

**Done when:** a socketed rune changes targeting in the event log;
`charges_left` drops by exactly the count of `rune` events; the rune breaks
at 0 and is auto-unsocketed; repair restores charges.

### Phase 7.4 — Acquisition: Summon Hall, then Adventure

Two loops in one sub-phase — ship Summon first (it's small, gives gold its
first sink, and finally makes 7.1–7.3 testable without the admin grant).

#### Summon Hall ✅ CODE COMPLETE (2026-07-03)

- ✅ `010_summons.sql`: master `summon_defs` (`cost` JSONB — a pluggable list
  of `{type:'gold',amount}` / `{type:'item',itemId,qty}` requirement objects;
  `pool` JSONB — a weighted `{speciesId, weight}` list; `enabled` — the
  retirement lever, since the audit FK below makes a referenced banner
  undeletable via the usual admin-CRUD 409 anyway) and instance/audit table
  `summons` (trainer, banner, **snapshots** of `cost`/`pool` at pull time,
  the `seed` `rollSummon()` used, `result_species_id`, `monster_id`) — same
  "freeze what mattered" shape as `matches`.
- ✅ `shared/rules/summon.js` `rollSummon(pool, seed)`: a pure, seeded
  weighted draw over a pool — no DB, no client input, same determinism
  contract as the engine's own RNG use.
- ✅ `server/services/summon.js` `performSummon()`: the client sends exactly
  ONE choice, `summonId` — cost, seed, and the drawn species are all decided
  server-side. Pays cost legs through a `REQUIREMENT_CHECKERS` **pluggable
  checker registry** (`{gold, item}` today, pay/refund per type) —
  claim-first-then-pay per leg, same shape as equipment's enhance; a losing
  leg (or a failure anywhere in the seed→mint→audit-insert span, including
  an unknown-species pool) triggers a compensating refund of every already-paid
  leg, and — since minting happens inside that same span — a compensating
  `unmintMonster()` too, so a failure after the free monster was minted can
  never leave it in the roster with nothing charged for it. A later "quest"
  requirement type is one new registry entry, never a branch in
  `performSummon()` — the closed-op-set philosophy the engine uses for
  skills/statuses, applied to costs.
- ✅ `GET /api/trainer/summon` → `{ summons }`, the enabled banners only;
  `POST /api/trainer/summon { summonId }` → `{ summonId, seed, monster,
  gold, inventory }`. **Deviation from this section's original draft:**
  grouped under the `trainer` domain (`/api/trainer/summon`, not the drafted
  top-level `/api/summon`) — same serverless-function-count reasoning as
  `/api/trainer/inventory` (7.1) and `/api/trainer/equipment/*` (7.2). A
  disabled or unknown `summonId` both 404 (a retired banner never leaks that
  it existed, same precedent as equipment's ownership 404s).
- ✅ Admin: `summon_defs` gets the **full Phase 5 workflow** in this one
  sub-phase — `src/data/summons.js` seed (2 banners), `validateSummon()`
  (`server/services/adminValidate.js`, `SUMMON_COST_TYPES` enum), guarded
  CRUD (`POST`/`DELETE /api/admin/summons`, 409 while any pull references a
  banner) and a `masterState()`/`GET /api/admin/master` `summonDefs` field
  (now 8 master tables) with a `pullCount` usage badge — a ✨ Summons tab in
  the admin console (`src/ui/admin.js`) mirrors the Items/Runes tabs' JSON
  textarea approach for `cost`/`pool`, plus an `enabled` checkbox.
- ✅ UI: a ✨ Summon Hall panel (`src/ui/summon.js`) — same panel shell as
  the 🎒 Inventory panel (msgs + body, one refresh-on-open) — lists each
  enabled banner as a card (name, description, a human-readable cost line,
  a Summon button); pulling shows the minted monster (emoji, name,
  species/element) and the new gold balance inline, and refreshes the
  header's gold chip the same way enhance/repair do.
  `src/services/content.js` gained `fetchSummonHall()`/`performSummon()` as
  the I/O boundary.
- ✅ Tests: `tests/summons.test.mjs` covers the seed grammar (ids
  unique/`sm_`-prefixed, every pool `speciesId` and cost `itemId` real) and
  `rollSummon()` determinism (same pool+seed ⇒ same draw) and weight
  coverage. No engine change — summoning never touches `resolve.js`; golden
  logs untouched.

**Remaining (operator step):** verify in a browser — pull `sm_novice` with
100 gold, confirm gold debits exactly once and the new monster appears in
the farm roster; grant `it_summon_scroll` via the admin console, pull
`sm_scroll`, confirm the scroll is consumed; disable a banner in the admin
✨ tab and confirm it disappears from the Summon Hall panel and 404s if
pulled directly.

**Done when:** a summon mints a monster exactly once for its cost with a
replayable seed.

#### Adventure ✅ CODE COMPLETE (2026-07-04)

- ✅ `011_adventures.sql`: master `adventure_defs` (`config` JSONB — steps,
  choices-per-step, a weighted node-type table, the wild `encounters` pool,
  `loot`/`gather` tables, `catchPct`; see `src/data/adventures.js`'s header
  for the full grammar) and instance table `adventure_sessions` (trainer,
  route, **frozen** `seed`/`map`/`party` — `party` mirrors `toLane()`'s
  battle-snapshot shape, `map` is `generateMap(config, seed)`'s output —
  `position`, `state` (`active → completed | failed | abandoned`), a running
  `loot` log, `ends_at`). At most one `active` session per trainer
  (`adventure_sessions_one_active_idx`, same partial-unique-index precedent
  as seasons).
- ✅ `shared/rules/adventure.js`: `generateMap()` (pure, seeded — every
  non-final step's options are a weighted node-type draw, the final step is
  forced all-`battle`, the exit guard), `deriveNodeSeed()` (a fresh,
  position-keyed mulberry32 stream per node — any node re-derivable in
  isolation from the session seed alone), `rollLoot()`, and (this step)
  `rollEncounter()` — draw `n` speciesIds with replacement off one node-seeded
  rng stream, same accounting style as `rollLoot`.
- ✅ `api/adventure/[...route].js` + `server/routers/adventure.js`: the 6th
  domain-grouped serverless function (Hobby-plan-cap reasoning unchanged;
  this was the "not yet built" entry `docs/ARCHITECTURE.md` already
  anticipated). `GET /api/adventure/state`, `POST /api/adventure/{start,
  move,abandon}` — `server/routes/adventure.js` are thin wire handlers over
  `server/services/adventure.js`.
- ✅ `server/services/adventure.js`: every read/write starts by lazily
  expiring overdue `active` sessions (`ends_at` past ⇒ `abandoned`, same
  read-then-claim shape as `ensureSeason`). `start()` claims the 3-monster
  party's busy lock (`claimPartyForAdventure`, one statement, same shape as
  `claimMonsterForJob`) with a compensating `releaseParty()` on any failure
  from the claim onward (same spirit as `performSummon`'s unmint/refund),
  freezes the chosen order's `toLane()` lanes (equipped gear + socketed runes
  included, same as `createMatch`) plus a display list into `party`, and
  mints/stores the map's seed. `move()` validates `choice` against the
  CURRENT step only (`options` is the only route data ever sent to the
  client — the full map, and every OTHER route's `config`, never leaves the
  server), claims the step exactly once (`claimAdvance`, same claim-guard
  shape as `applyOrder`), then dispatches the node through a closed
  `NODE_RESOLVERS` registry (`battle`/`chest`/`gather` — a new node kind is
  one registry entry, never a branch in `move()`): chest/gather roll+grant
  via the inventory repo; battle calls `resolveBattle()` directly (seeded
  from `deriveNodeSeed`, **no `matches` row** — an adventure fight has no
  opposing trainer and only ever needs to update this one session), settles
  the party's rune durability the same way `resolveMatch` does, and on a win
  rolls a `catchPct` chance to mint one of the defeated wild species via
  `mintMonster`. A lost/drawn battle fails the run; the final step's win
  completes it; either terminal state releases the party. The event log is
  never persisted to the row (re-derivable forever from the stored seed) —
  only in the response.
- ✅ Tests: `tests/adventures.test.mjs` gained `rollEncounter()` coverage
  (determinism, shape, weight coverage) alongside the foundations step's
  `generateMap`/`deriveNodeSeed`/`rollLoot` tests. The DB-touching service
  isn't unit-tested, same precedent as `matches.js`/`pvp.js`. No engine
  change; golden logs untouched.
- ✅ Admin: `adventure_defs` gets the CRUD half of the Phase 5 workflow —
  `POST`/`DELETE /api/admin/adventures` (`validateAdventure()`, guarded 409
  delete while a session references a route), a `masterState()` /
  `GET /api/admin/master` `adventureDefs` field with a `sessionCount` usage
  badge, and a 🗺 Adventures tab in the admin console (`src/ui/admin.js`)
  mirroring the ✨ Summons tab — id/name/description/enabled fields plus one
  JSON textarea for the whole `config` grammar.
- ✅ UI: a 🗺 Adventure panel (`src/ui/adventure.js`) — same panel shell as
  🎒 Inventory / ✨ Summon Hall (msgs + body, refresh-on-open).
  `src/services/content.js` gained `fetchAdventureState()`/
  `startAdventure()`/`moveAdventure()`/`abandonAdventure()` as the I/O
  boundary. With no active run: one card per enabled route plus a shared
  party picker (borrowed from the Arena defense editor's row shape —
  `loadFarm()`'s `busyUntil`/`busyKind` disable a busy monster, pick order is
  shown and IS the lane order) and a per-route "Set out" button gated on
  exactly 3 picks. With an active run: a step header ("Verdant Trail — step
  3/5"), party chips, the loot log so far, and the current step's options as
  Go-able cards (⚔/🎁/🌿), plus an Abandon button (confirm-gated). A move's
  outcome (win/loss with an optional fall count read off the response's
  `t:"fall"` events, loot dropped, a catch) is narrated as a message line —
  no cutscene replay this slice, the full event log only rides the response
  for a future replay feature (never computed client-side). A terminal
  session (completed/failed/abandoned) shows a one-screen run summary, kept
  in module memory (same precedent as `ui/summon.js`'s results map, since the
  state read only ever returns *active* sessions) until "New adventure" is
  clicked.

**Remaining (operator step):** verify in a browser — start a run with 3
monsters and confirm they show busy on the 🏕 farm panel; hit a chest or
gather node and confirm the items land in the 🎒 Inventory panel; win a
battle node and, on a catch, confirm the new monster appears in the roster;
lose a battle (or Abandon) and confirm the party frees up again; try
starting a second run while one is active and confirm it 409s.

**Done when:** a summon mints a monster exactly once for its cost with a
replayable seed; a full adventure run yields loot in the inventory (and any
catch in the roster) and the party unlocks correctly, including on abandon —
both loops playable end to end from the UI, no direct API calls required.

## Phase 8 — Marketplace ✅ CODE COMPLETE (2026-07-06)

The first player-to-player economy: gold finally circulates between trainers
instead of flowing only faucet → sink. Promoted from its original slot as
sub-phase 7.5 (2026-07-04 renumbering): it is the one place that needs real
transactional care, and it depends on all of Phase 7 being live (goods worth
selling now exist via Summon Hall and Adventure), so it stands alone.

There are now TWO ways to sell. The **marketplace** (below) is
player-to-player: a trainer picks their own price and waits for a buyer.
**Sell-to-system** is the new instant path, riding the existing 🎒 Inventory
panel/trainer domain rather than the new market domain: a trainer sells an
item stack (qty picked), an unequipped equipment piece, or an unsocketed
rune straight to the system for a fixed default price set per master def —
deliberately the low floor, not a place to shop for a good deal. Every
sellable def's system price is the natural price floor a marketplace listing
sits above; nobody would list below it. Monsters have no system price — they
are marketplace-only.

- ✅ `013_marketplace.sql`: `marketplace_listings` (seller, kind
  `item|equipment|rune|monster`, ref id, qty, price, status
  `open|sold|cancelled`, created/closed timestamps, buyer on sale). Listing
  **escrows** the good — removed from usable inventory at list time (items:
  qty split off the stack; equipment: must be unequipped; runes: must be
  unsocketed; monsters: detached to the unassigned state, see below);
  cancel returns it. Escrow means a sold good can never have
  been used or mutated between list and buy. The same migration adds
  `sell_gold INT NOT NULL DEFAULT 0` to `item_defs`, `equipment_defs`, and
  `rune_defs` (0 = not sellable to the system; otherwise the per-unit
  instant-sale price — balance data, seeded from `src/data/*.js` and
  editable in the admin console), and drops NOT NULL on
  `trainer_equipment.trainer_id`, `monster_equipment.trainer_id`, and
  `runes.trainer_id` so a listed instance can be escrowed as ownerless
  (`trainer_id = NULL`), the same "unassigned" precedent
  `012_monster_release.sql` set for monsters. Monster escrow reuses
  that unassigned state too (no busy-lock needed): listing detaches
  (`trainer_id = NULL`), cancel re-attaches to the seller, buy attaches to
  the buyer; the admin Trainers tab's unassigned pool must exclude monsters
  referenced by open listings.
- ✅ Monsters are listable only when free of obligations: not busy, not in
  the defense formation, equipment and runes stripped first — validated
  server-side, 409 naming what blocks it (same guarded-delete spirit as
  admin CRUD).
- ✅ New `api/market/[...route].js` domain + `server/routers/market.js` (the
  7th serverless function — the one sanctioned reason to add a top-level
  `api/` entry, CLAUDE.md §5): `GET /api/market/browse` (search/filter: kind,
  text, price range, paging — not the bare `/api/market`: a Vercel catch-all
  `[...route].js` never matches its own bare prefix, the same reason
  `api/activities.js` stays a plain top-level file for its one bare route, so
  browse lives one path segment down), `POST /api/market/list` / `buy` /
  `cancel`. Handlers stay thin over `server/services/market.js` +
  `server/repos/market.js`.
- ✅ Sell-to-system endpoint: `POST /api/trainer/inventory/sell {kind:'item'|
  'equipment'|'rune', defId?/id?, qty?}` — grouped under the existing
  trainer domain (one more row in `server/routers/trainer.js`, not a new
  serverless function, CLAUDE.md §5). Same claim-first shape as the rest of
  inventory: items decrement the owned stack guarded by `qty >= amount`;
  equipment/runes are a guarded DELETE requiring the piece be unequipped/
  unsocketed; either way, a won claim is followed by a gold credit, with a
  compensating restore of the removed good if the credit leg loses a race.
  Returns the refreshed inventory + gold. Monsters are not sellable to the
  system — marketplace only.
- ✅ Concurrency: the codebase's one-statement claim CTE shape throughout
  (mark sold + debit buyer + credit seller + transfer ownership, guarded by
  `status = 'open'` and `seller_id <> buyer`) — the same exactly-once shape
  as activity settlement; a losing leg after a won claim gets a compensating
  revert, same as enhance/repair/summon.
- ✅ Self-purchase is rejected; price bounds validated server-side (positive
  integer, sane cap).
- ✅ UI: a 🏪 Marketplace panel (same shell as Inventory/Summon/Adventure:
  msgs + body, refresh-on-open) — catalog with search/filter + a "my
  listings" management view (cancel buttons, sold history, and a
  "Sell something" picker over the trainer's own bag/roster). All I/O
  through `src/services/content.js` helpers, never direct fetch from `ui/`.
  The 🎒 Inventory panel's three tabs (Items/Equipment/Runes) each grow a
  price-labeled "Sell" control (a qty picker for item stacks), hidden when a
  def's `sell_gold` is 0 or the piece is currently equipped/socketed — the
  marketplace's "list an item" flow is the other sell path, reached from its
  own panel.

**Remaining (operator step):** run `npm run db:migrate` (013) and `npm run
db:seed` (loads the seeded `sell_gold` values); then verify in a browser
with two real accounts — list an item, an equipment piece, a rune, and a
monster, and confirm each leaves the seller's usable inventory (bag/roster)
the moment it's listed; buy each from the second account and confirm gold
and the good transfer exactly once; cancel a listing and confirm the good
returns to the seller; confirm a listed monster is blocked from work,
battle, and adventure, and is hidden from the admin console's unassigned
pool; sell an item to the system from the 🎒 panel and confirm gold credits
exactly `sell_gold × qty`.

**Done when:** with two real accounts, list → buy transfers gold and goods
exactly once; a concurrent second buy answers 409; cancel restores the
escrowed good; a listed monster can't be sent to work, battle, or adventure
while escrowed; selling to the system credits exactly `sell_gold × qty`
exactly once and the good is gone from the inventory.

## Phase 9 — Tournaments, Guilds & GVG

Too big for one shot — staged as seven sub-phases (9.1–9.7, 2026-07-06
re-plan of this section's original draft), each independently shippable.
Order rationale: pure rules first (bracket + reward math everything else
consumes); **tournaments before guilds** — a tournament needs no guild and
exercises the entire admin-scheduled-event lifecycle (registration window →
lock → lazy bracket resolution → position + percentile rewards → cancel →
results history) on the simplest unit, one trainer's team, so every
transactional pattern is proven before GVG composes it at guild level;
guilds standalone next; then GVG setup, which reuses the tournament's event
grammar verbatim; the one engine change (carry-over battle state) isolated
in its own sub-phase; GVG resolution last, consuming all of the above.

Dependencies: Phase 6 (team snapshots, seasons' lazy claim shapes, Elo
precedent), Phase 7 (reward grammar grants items/equipment/monsters via the
existing inventory/mint paths), Phase 8 (gold circulates, so guild creation
and entry fees are meaningful sinks).

Cross-cutting rules for all sub-phases:

- **No cron, ever** (CLAUDE.md §1.5). "The tournament begins automatically"
  means: state advances lazily on the next read after a deadline passes —
  `settleTournaments()`/`settleGvg()` run at the top of their own domain's
  reads/writes AND piggyback on the same authenticated reads
  `settleActivities` rides, behind a near-free indexed "anything due?"
  probe. Every advance is a claimed, exactly-once step (the
  `ensureSeason`/`claimResolve` shape), so racing reads can't double-run a
  round or double-pay a reward.
- **Freeze at registration** (CLAUDE.md §1.1/1.6). A registered team's
  lanes are snapshotted via `toLane()` (gear + socketed runes included, the
  `adventure_sessions.party` precedent) the moment the entry is accepted,
  and every battle resolves from frozen snapshots + a stored seed — fully
  replayable, and nothing a player does after registering can change it.
- **Locks are busy locks.** Registered monsters take `busy_kind =
  'tournament'`/`'gvg'` through the same atomic claim `claimPartyForAdventure`
  uses, and are released exactly once by settlement, withdrawal, or cancel —
  compensating release on any failure after a won claim.
- **No `matches` rows.** Event battles have no interactive attacker — they
  call `resolveBattle()` directly and store seed + result on their own
  match tables (the Adventure precedent), never the PVP `matches` table.
- **One reward grammar, one payout path** for tournaments AND GVG: fixed
  rewards for positions 1/2/3 plus percentile tiers for everyone else,
  granted through a pluggable registry (the `REQUIREMENT_CHECKERS`
  precedent) — a new reward type is a registry entry, never a branch.

### Phase 9.1 — Shared event rules (pure, no DB, no UI) ✅ CODE COMPLETE (2026-07-06)

The `shared/rules/` + validator layer everything later consumes. Zero
schema, zero endpoints — lowest-risk slice, fully unit-testable.

- ✅ `shared/rules/bracket.js`: pure, seeded single-elimination math —
  `generateBracket(entrantIds, seed)` (seeded shuffle, pad to the next power
  of two with byes, byes auto-advance), `nextRound(results)`, plus a
  3rd-place decider between the two semifinal losers (positions 1/2/3 must
  be exact, per the reward spec). `placements(bracket)` assigns every
  entrant a final rank: elimination depth, ties within a round broken by a
  seeded deterministic draw so percentile assignment is exact and
  replayable. Same determinism contract as `rollSummon`/`generateMap`.
- ✅ `shared/rules/rewards.js`: the reward grammar + resolution.
  `positionRewards`: `{1: [...], 2: [...], 3: [...]}`; `percentileRewards`:
  ordered `{fromPct, toPct, rewards}` tiers validated to cover 1–100 with no
  overlap (the GAME_DESIGN §6.5 percentile precedent). A reward is
  `{type:'gold',amount} | {type:'item',itemId,qty} |
  {type:'equipment',equipmentDefId} | {type:'rune',runeDefId} |
  {type:'monster',speciesId}`. `resolveRewards(placements, config)` → flat
  `[{trainerId, rewards}]` — pure math; granting is the caller's job.
- ✅ `server/services/adminValidate.js`: `validateEventSchedule()`
  (registration `starts_at < ends_at`, both in the future at creation) +
  `validateEventRewards()` (grammar above, every itemId/speciesId/defId
  names a real master row — checked at the service layer like summon
  pools). Written once here, shared verbatim by tournaments (9.2) and GVG
  events (9.5).
- ✅ Tests: bracket determinism (same entrants + seed ⇒ same pairings), bye
  math at non-power-of-two sizes (2, 3, 5, 8, 100 entrants), placement/
  percentile edge cases (tiny fields where tiers collapse), reward-grammar
  round-trips + rejects.

**Done when:** `npm test` covers bracket + placement + reward math with
golden-style determinism cases; no runtime surface changed.

### Phase 9.2 — Tournaments: schema, admin lifecycle, registration ✅ CODE COMPLETE (2026-07-06)

- ✅ `014_tournaments.sql`: `tournaments` (admin-created instance rows, not
  master data: name/description, `reg_starts_at`, `reg_ends_at`, `seed`
  (minted at creation), rewards JSONB (9.1 grammar), optional `entry_fee`
  gold, status `scheduled → registration → running → completed |
  cancelled`, standings JSONB when done), `tournament_entries` (tournament,
  trainer UNIQUE per tournament, frozen 3-monster team snapshot, locked
  monster ids, entered_at), `tournament_matches` (tournament, round,
  position-in-round, both entry ids, seed, winner, result JSONB — one row
  per resolved pairing, replayable forever).
- ✅ Routes ride the EXISTING `battle` domain (`/api/battle/tournaments` list +
  detail, `/api/battle/tournament/register|withdraw` — new rows in
  `server/routers/battle.js`, NOT a new serverless function: the guild
  domain (9.4) takes one of the two remaining Hobby-cap slots, and Phase 10
  may want the last, CLAUDE.md §5). Admin create/cancel/list rides
  `api/admin/` like every other admin write.
- ✅ Registration (`server/services/tournament.js`): validated against the
  window and DB state only — exactly 3 owned, free monsters; optional
  entry-fee debit claim-first-then-pay; the party busy-claim
  (`busy_kind='tournament'`) and the `toLane()` snapshot freeze happen with
  compensating release/refund on any later failure (the `performSummon`
  shape). Withdraw is allowed only while registration is open: guarded
  entry delete + lock release + fee refund.
- ✅ Admin: 🏆 Tournaments tab in the admin console — create (name, window,
  rewards JSON textarea per the Summons/Adventures precedent, entry fee),
  a live entrant count, and a Cancel button at ANY status: cancel is a
  claimed status flip that releases every entrant's locks and refunds
  entry fees (compensating, idempotent), pays nothing, and keeps the row
  visible in history.
- ✅ UI: 🏆 Tournament panel (same shell as Summon/Adventure: msgs + body,
  refresh-on-open) — upcoming/open tournaments with a register flow
  (3-monster party picker borrowed from Adventure's), my entry + withdraw
  while open, and a list of past tournaments (detail view lands in 9.3).

**Remaining (operator step):** run `npm run db:migrate` (014); then verify
in a browser with two real accounts — create a tournament (with and without
an entry fee) from the 🏆 Tournaments admin tab and confirm it appears in the
🏆 Tournament panel at its registration window; register exactly 3 free
monsters from one account and confirm they show busy everywhere (farm, match
creation, adventure, marketplace listing) and the entry fee (if any) is
debited exactly once; confirm a 4th pick, a busy monster, double-registration,
and a post-window registration all 409 with the server's message; withdraw
and confirm the fee refunds and the party frees up; register again, then
admin-cancel the tournament and confirm the entry's locks release and its
fee refunds exactly once, and the row stays visible as "Cancelled" history.

**Done when:** an admin-created tournament appears in the panel at its
window; a player registers exactly 3 free monsters and they show busy
everywhere (farm, match creation, adventure, marketplace listing);
double-registration and post-window registration 409; withdraw and admin
cancel both release locks and refund fees exactly once.

### Phase 9.3 — Tournaments: lazy resolution, rewards, results ✅ CODE COMPLETE (2026-07-07)

Remaining (operator step): `npm run db:migrate` (015).

- `015_tournament_rewards.sql`: ONE new column, `tournament_entries.reward`
  (NULL until settlement stamps it — the `payoutSeason` `reward IS NULL`
  precedent). Locked design decision: NO bracket JSONB column anywhere — a
  tournament's bracket is re-derived on every read from (entry ids ordered
  by id ASC, `tournaments.seed`, and 014's `tournament_matches` rows) via
  `shared/rules/bracket.js`'s new `replayBracket()` (CLAUDE.md §1.6).
- `shared/rules/bracket.js` gains two pure exports: `derivePairingSeed(seed,
  round, position)` (the `deriveNodeSeed`-style per-pairing battle seed) and
  `replayBracket(entrantIds, seed, results)` (folds a durable log of decided
  pairings back through `generateBracket`/`nextRound`/`resolveThirdPlace`,
  returning `{bracket, complete}`).
- `settleTournaments()` (`server/services/tournament.js`), called at the top
  of every tournament read: a bulk cosmetic `scheduled -> registration`
  status walk, then per due tournament — `scheduled`/`registration` past
  `reg_ends_at` with fewer than 2 entries auto-cancels (the exact admin-
  cancel refund/release path, factored into a shared `cancelCore()`);
  otherwise a claimed flip to `running` falls straight into settling it.
  A `running` tournament resolves ONE round per pass (bounded work per
  serverless invocation): every undecided real pairing in the replayed
  bracket's current round gets `resolveBattle()` called directly (no
  `matches` row — the adventure.js precedent) off `derivePairingSeed()`,
  persisted via an exactly-once `insertTournamentMatch()` claim; a draw
  breaks with one more roll (`makeRng(seed).chance(50)`) off that same
  pairing seed. Resolving the final round also resolves the 3rd-place
  decider in the same pass. Once the re-replayed bracket is `complete`:
  `placements()` → `resolveRewards()` → one idempotent `claimEntryReward()`
  per entry (`reward IS NULL` gate), granting through a pluggable
  `REWARD_GRANTERS` registry (gold/item/equipment/rune/monster — the
  `performSummon` REQUIREMENT_CHECKERS precedent) and releasing that
  entry's party lock, THEN `claimCompleteTournament()` stamps the
  standings JSONB and flips to `completed`. Admin cancel mid-`running`
  still works unchanged: the guarded status flip wins the race either way.
- Results: `GET /api/battle/tournament/detail?id=` (`getTournamentDetail()`)
  returns the tournament summary, entrants (display only, never lanes),
  the bracket re-derived round by round with each pairing's stored seed,
  the 3rd-place pairing, the enriched standings (rank/trainer/reward), and
  the caller's own entry summary. The 🏆 panel's every card/history row
  gained a "Details" button swapping the body for this view: round labels
  ("Round N" / "Semifinals" / "Final" / "3rd-place match"), byes shown as
  "bye", unplayed pairings in a running bracket marked "pending".
- Tests: `tests/bracket.test.mjs` extended with `derivePairingSeed`/
  `replayBracket` coverage (determinism, partial results, the 2-entrant
  field, the 3rd-place row convention, one-round-at-a-time resolution) —
  the settlement service itself follows the untested-DB-service precedent
  (`matches.js`/`pvp.js`).

**Done when:** after `reg_ends_at`, a plain read advances the tournament
round by round and two racing reads never double-resolve a round; positions
1/2/3 receive their configured rewards and everyone else their percentile
tier, each exactly once; all locks release; the bracket + standings are
browsable later and every match's seed reproduces its result.

### Phase 9.4 — Guilds: creation, membership, roles ✅ CODE COMPLETE (2026-07-07)

Remaining (operator step): `npm run db:migrate` (016).

- ✅ `016_guilds.sql`: `guilds` (case-insensitively unique name via
  `guilds_name_idx` on `lower(name)`, description/emblem, leader id,
  created_at), `guild_members` (guild, trainer UNIQUE — one guild per
  trainer, role `leader|officer|member`, joined_at), `guild_applications`
  (application flow, not invites — the user-described flow: player applies,
  leader accepts/rejects; no status column at all — a pending application IS
  a row's existence, accept/reject both just DELETE it, keeping this thin as
  directed). Guilds are player-created instance data, not admin master data
  (no `src/data/*.js` seed, no admin console tab); creation costs a flat 500
  gold (`GUILD_CREATE_COST`, claim-first-then-pay + LIFO compensation, the
  `performSummon` shape).
- ✅ New `api/guild/[...route].js` domain + `server/routers/guild.js` (the
  8th serverless function — the second sanctioned reason, after the
  marketplace, to add one, CLAUDE.md §5): `browse`/`me`/`create`/`apply`/
  `accept`/`reject`/`leave`/`kick`/`promote`/`transfer`
  (`server/routes/guild.js` thin wire handlers over `server/services/
  guild.js`). Every write re-derives the caller's role from
  `guild_members` via `getMembership()` first (leader-only accept/reject/
  kick/promote/transfer, 403 otherwise) — never trusts a role from the
  request body. `leave`/`kick`/`updateMemberRole` are guarded statements
  that exclude `role = 'leader'` from their WHERE
  (`server/repos/guilds.js`) — a leader can never leave (409 "transfer
  leadership first"; disbanding a guild outright is out of scope) or be
  kicked/demoted directly; only `transfer`'s `claimTransferLeadership` (a
  guarded `guilds.leader_id` UPDATE, the real claim, followed by swapping
  both member rows' roles in one sequence) ever moves the `'leader'` role.
  `UNIQUE(trainer_id)` on `guild_members` is the one-guild-per-trainer race
  guard every join path (create, an accepted application) 23505s against.
- ✅ UI: 🏰 Guild panel (`src/ui/guild.js`, same msgs+body, refresh-on-open
  shell as Tournament/Summon/Adventure) — guildless view (my pending
  applications, a browse list with per-guild Apply/Applied, a "Found a
  guild" form labeled with the gold cost); member/officer view (guild
  header, full roster with role badges, a Leave button; officers
  additionally see the pending-application queue read-only, per the
  server's `me()` role gate); leader view (all of the above plus per-
  application Accept/Reject and per-member, non-self Kick/Promote/Demote/
  "Make leader" — transfer confirm()-gated — controls, with Leave replaced
  by a "transfer leadership first" hint). Pure display + action over
  `src/services/content.js`'s new `fetchGuildBrowse()`/`fetchGuildMe()`/
  `createGuild()`/`applyGuild()`/`acceptGuildApplication()`/
  `rejectGuildApplication()`/`leaveGuild()`/`kickGuildMember()`/
  `promoteGuildMember()`/`transferGuildLeadership()`.

**Done when:** two real accounts form a guild (one creates and pays the
gold cost, the other applies and is accepted); role checks hold (a member
cannot accept applications or kick — 403); one-guild-per-trainer enforced;
leaving/kicking updates both sides' views.

### Phase 9.5 — GVG events: schedule, team submission, lineup

The tournament event lifecycle, re-instantiated at guild level. No battle
resolution yet — this sub-phase is entirely setup-side, so it can ship and
be verified before the engine work lands.

- `016_gvg.sql`: `gvg_events` (admin-created, same schedule + rewards
  grammar as tournaments — 9.1's validators verbatim, plus GVG knobs:
  min/max teams per guild, fixed at 1–10 per the design), `gvg_teams`
  (event, guild, submitting trainer, frozen 3-monster snapshot, locked
  monster ids, leader-assigned `battle_order` when selected — NULL means
  submitted-but-not-picked), `gvg_registrations` (event, guild UNIQUE per
  event, registered by leader), `gvg_wars` (the per-pairing rows 9.7
  resolves into: event, round, both guilds, seed, winner, per-battle
  results JSONB).
- Flow (all under the guild domain — `/api/guild/gvg/*`, no new function):
  during the event's registration window any guild MEMBER submits a team
  (same 3-free-monster validation + busy claim + snapshot freeze as
  tournament registration, `busy_kind='gvg'`; one submission per trainer
  per event; withdraw-own-team while unpicked); the LEADER (only) selects
  1–10 submitted teams and sets their battle order (a guarded write
  re-validating role + event window + team count); the LEADER (only)
  registers the guild — 409 unless a valid ordered lineup exists. At window
  close, settlement releases every submitted-but-unselected team's locks
  (and all locks, if the guild never completed registration) — nobody stays
  locked for a lineup that never fought.
- Admin: ⚔ GVG tab mirroring the 🏆 tab — create (window, rewards, team
  bounds), entrant-guild count, cancel-anytime with full release.
- UI: the 🏰 Guild panel grows a GVG section — members see open events + a
  "submit my team" picker; the leader additionally sees submitted teams
  with pick/order controls (order IS the relay order, first to last) and
  the register button.

**Done when:** members of a real guild submit teams (monsters lock);
the leader picks and orders a lineup and registers; a non-leader attempting
selection or registration gets 403; window close releases unpicked teams'
monsters; admin cancel releases everything.

### Phase 9.6 — Engine: carry-over battle state (pure, isolated)

The one engine change in Phase 9, landed alone so its blast radius is a
single reviewable diff with golden coverage — everything before it ships
without touching `shared/engine/`.

- `resolveBattle()` lane snapshots accept optional `startHp` and
  `startStatuses` (`liveUnit()` reads `hp: d.startHp ?? d.maxHp ?? d.hp`,
  seeds `statuses` from `startStatuses` instead of `[]`; a unit entering at
  `startHp <= 0` is born fallen). Readiness gauges and cooldowns still
  reset per battle — the design carries LIFE AND STATUS between relay
  battles, nothing else.
- The result envelope gains `finalState: {a: [{idx, hp, statuses}], b:
  [...]}` — the surviving state 9.7 feeds into the next chained battle.
  Like 7.3's `runeUse`, this is additive: no fixture carries `startHp`, so
  every existing event array must be byte-identical — golden logs
  regenerated in the same commit for the envelope field only, verified not
  assumed.
- Tests: a chained-battle case in a new `tests/relay-engine.test.mjs` —
  battle 1's `finalState` fed as battle 2's `startHp`/`startStatuses`
  reproduces deterministically; absent-vs-empty carry fields produce
  identical logs (the 7.2/7.3 back-compat precedent); a DOT status carried
  in ticks on the carried unit's first turn.

**Done when:** golden logs diff only by the additive envelope field; the
relay test chain is deterministic; a free/PVP/adventure battle's behavior
is provably unchanged.

### Phase 9.7 — GVG: war resolution, rewards, results

- Relay resolution (`server/services/gvg.js`): a war between two ordered
  lineups is a chain of `resolveBattle()` calls — each side fields its
  current team; the LOSING side's next team (by `battle_order`) steps in
  while the winner's survivors carry their exact `finalState` hp/statuses
  forward (the user-specified rule: life and status are NOT reset, the
  standing team fights until its last unit falls). Every battle in the
  chain is seeded off the war seed + battle index (`deriveNodeSeed`
  precedent) and appended to `gvg_wars.results` — the whole war replayable
  from one stored seed. A drawn battle (turn cap) eliminates BOTH current
  teams — the design decision to lock here, mirroring how a drawn
  tournament battle needs a deterministic winner rule (seeded coin flip
  recorded in the result) so brackets always advance.
- `settleGvg()`: same lazy shape as 9.3 — registration close with < 2
  registered guilds auto-cancels; the guild bracket generates off the event
  seed via 9.1's `generateBracket`; one round of wars per claimed pass;
  placements + 3rd-place decider identical to tournaments.
- Rewards: 9.1's position + percentile resolution over GUILD placements,
  paid to the trainers whose teams were in the guild's registered lineup
  (participants, not the whole roster — the locked design decision: rewards
  follow contribution), each payout an idempotent claimed statement. All
  `busy_kind='gvg'` locks release on the guild's elimination, not the
  event's end — a knocked-out guild's monsters go home early.
- UI: the 🏰 panel's GVG section gains live event state (bracket, my
  guild's current war, per-battle summaries — text summaries, no cutscene
  replay, the Adventure precedent) and a results history (standings,
  rewards, past wars browsable per event).
- Docs: GAME_DESIGN §6.4 and ARCHITECTURE's data-model section updated to
  the shipped shapes in the same change (standing rule below).

**Done when:** two real guilds register lineups; after the window a plain
read resolves wars round by round exactly once (racing reads safe); the
relay carry-over is visible in results (a weakened survivor starts the next
battle at its carried HP); positions and percentile tiers pay guild
participants exactly once; eliminated guilds' monsters free immediately;
the full event is browsable afterward and replayable from stored seeds.

## Phase 10 — Chat, notifications & photo quest (later)

Communication layers first (they're low-risk and every earlier system wants
to emit events into them), then the one deliberately-parked high-risk
feature. Everything here stays on lazy polling — no websockets until a
feature proves the need (CLAUDE.md §1.5); ARCHITECTURE §394 already flags
live chat as the first legitimate websocket trigger *if* polling feels bad in
practice.

- Notifications first: `014_social.sql` starts with a `notifications` table
  (trainer, kind, payload JSONB, created_at, read_at). Existing services
  write rows at their event points — season payout (`payoutSeason`), listing
  sold (Phase 8), guild application/acceptance/war result (Phase 9), summon
  banner events — one insert next to the already-atomic claim, never a new
  delivery mechanism. Delivered by piggybacking a small unread count on
  existing authenticated reads (`/api/trainer/me`), fetched in full on
  demand; a 🔔 header badge + dropdown panel marks-read on view.
- Messages/chat: player-to-player mail and guild chat as plain rows
  (`messages`: sender, recipient-or-guild, body, created_at, read_at),
  polling on panel open / a modest interval while the panel is visible.
  Server-side length + rate limits, a block list, and a report flag from day
  one — moderation basics before moderation problems.
- Photo quest last (GAME_DESIGN §6.5 ⚠ high risk — image-scored summon
  quest): daily/weekly hint published as master data (`quest_defs`, admin
  CRUD per the Phase 5 workflow); players upload a photo; a **pluggable
  scorer** grades match quality server-side; rewards by percentile (<1%,
  1–20%, 20–50%, 50–100%) settle when the quest window closes — lazily, on
  read, like seasons. The scorer is a registry interface (same closed-set
  philosophy as `NODE_RESOLVERS`/`REQUIREMENT_CHECKERS`): the first
  implementation can be an image-embedding similarity call behind an env
  key, swappable without touching quest logic. Needs image storage (object
  store, not the DB), content moderation + abuse handling (pre-score NSFW
  filter, report/ban hooks into Phase 10's moderation basics), and
  rate/size limits on upload. Ship behind an `enabled` flag on the quest
  def — the retirement lever precedent from `summon_defs`. Percentile
  rewards mean scoring is relative: settle rewards only at window close,
  one idempotent claimed payout per entrant, never on upload.

**Done when:** a sold listing / accepted application / season payout each
produce exactly one notification and the badge clears on read; two accounts
exchange mail and guild chat with rate limits enforced; a photo-quest window
accepts uploads, scores them through the pluggable scorer, and pays
percentile rewards exactly once at close — with the scorer swappable in
config without code changes to the quest flow.

## Standing rules while executing

- Every phase updates docs/ + CLAUDE.md if it changes an interface.
- Engine changes always come with golden-log tests.
- Never widen an API to accept a value the server could look up itself.
