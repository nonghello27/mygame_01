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
  domain (9.4) takes one of the two remaining Hobby-cap slots, and Phase 11
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

### Phase 9.5 — GVG events: schedule, team submission, lineup ✅ CODE COMPLETE (2026-07-07)

Remaining (operator step): `npm run db:migrate` (017).

The tournament event lifecycle, re-instantiated at guild level. No battle
resolution yet — this sub-phase is entirely setup-side, so it can ship and
be verified before the engine work lands.

- ✅ `017_gvg.sql`: `gvg_events` (admin-created, same schedule + rewards
  grammar as tournaments — 9.1's validators verbatim, plus GVG knobs:
  min/max teams per guild, fixed at 1–10 per the design), `gvg_teams`
  (event, guild, submitting trainer, frozen 3-monster snapshot, locked
  monster ids, leader-assigned `battle_order` when selected — NULL means
  submitted-but-not-picked), `gvg_registrations` (event, guild UNIQUE per
  event, registered by leader), `gvg_wars` (the per-pairing rows 9.7
  resolves into: event, round, both guilds, seed, winner, per-battle
  results JSONB).
- ✅ Flow (all under the guild domain — `/api/guild/gvg/*`, no new function):
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
- ✅ Admin: ⚔ GVG tab mirroring the 🏆 tab — create (window, rewards, team
  bounds), entrant-guild count, cancel-anytime with full release.
- ✅ UI: the 🏰 Guild panel grows a GVG section — members see open events + a
  "submit my team" picker; the leader additionally sees submitted teams
  with pick/order controls (order IS the relay order, first to last) and
  the register button.

**Done when:** members of a real guild submit teams (monsters lock);
the leader picks and orders a lineup and registers; a non-leader attempting
selection or registration gets 403; window close releases unpicked teams'
monsters; admin cancel releases everything.

### Phase 9.6 — Engine: carry-over battle state (pure, isolated) ✅ CODE COMPLETE (2026-07-07)

The one engine change in Phase 9, landed alone so its blast radius is a
single reviewable diff with golden coverage — everything before it ships
without touching `shared/engine/`.

- ✅ `resolveBattle()` lane snapshots accept optional `startHp` and
  `startStatuses` (`liveUnit()` reads `hp: d.startHp ?? d.maxHp ?? d.hp`,
  seeds `statuses` from `startStatuses` instead of `[]`; a unit entering at
  `startHp <= 0` is born fallen). Readiness gauges and cooldowns still
  reset per battle — the design carries LIFE AND STATUS between relay
  battles, nothing else.
- ✅ The result envelope gains `finalState: {a: [{idx, hp, statuses}], b:
  [...]}` — the surviving state 9.7 feeds into the next chained battle.
  Like 7.3's `runeUse`, this is additive: no fixture carries `startHp`, so
  every existing event array must be byte-identical — golden logs
  regenerated in the same commit for the envelope field only, verified not
  assumed.
- ✅ Tests: a chained-battle case in a new `tests/relay-engine.test.mjs` —
  battle 1's `finalState` fed as battle 2's `startHp`/`startStatuses`
  reproduces deterministically; absent-vs-empty carry fields produce
  identical logs (the 7.2/7.3 back-compat precedent); a DOT status carried
  in ticks on the carried unit's first turn.

**Done when:** golden logs diff only by the additive envelope field; the
relay test chain is deterministic; a free/PVP/adventure battle's behavior
is provably unchanged.

### Phase 9.7 — GVG: war resolution, rewards, results ✅ CODE COMPLETE (2026-07-07)

Remaining (operator step): `npm run db:migrate` (018).

- ✅ `018_gvg_rewards.sql`: ONE new column, `gvg_teams.reward` (NULL until
  settlement stamps it — the exact `tournament_entries.reward` (015)
  precedent); rewards follow CONTRIBUTION, not guild membership, so the
  gate lives on `gvg_teams` (one claim per lineup team), never on
  `gvg_registrations`/`gvg_events`.
- ✅ Relay resolution (`shared/rules/gvgWar.js`'s `resolveWarRelay()`,
  called from `server/services/gvg.js`): a war between two ordered lineups
  is a chain of `resolveBattle()` calls — each side fields its current
  team; on a decisive battle the LOSING side's next team (by
  `battle_order`) steps in FRESH while the WINNING side's current team
  carries its exact `finalState` hp/statuses (9.6) forward into the next
  battle; a DRAWN battle (the engine's turn-cap) eliminates BOTH current
  teams — neither carries anything forward. The war ends the instant a
  side has no next team to field; if both sides exhaust at once (a draw
  when both current teams were each side's last), the tie breaks with one
  more deterministic roll off the war seed itself (`makeRng(warSeed)
  .chance(50)`, recorded as `tiebreak:true`). Every battle in the chain is
  seeded off the war seed + battle index (`deriveNodeSeed` precedent) and
  the whole war is replayable from one stored seed plus the two guilds'
  frozen `gvg_teams.team` snapshots — only a small per-battle summary
  (`{index, teamA, teamB, seed, outcome, aAlive, bAlive}`) persists in
  `gvg_wars.results`, never the full event log (CLAUDE.md §1.6).
- ✅ `settleGvg()`/`settleRunningGvg()`: same lazy shape as 9.3's
  `settleTournaments()`/`settleRunning()` — registration close with < 2
  registered guilds auto-cancels; the guild bracket re-derives every read
  from (registered guild ids, the event's seed, and `gvg_wars` rows already
  resolved) via `shared/rules/bracket.js`'s `replayBracket()` — no bracket
  JSONB column anywhere; one round of real, undecided pairings resolves per
  claimed pass (skip byes), plus the 3rd-place decider once its own two
  sides are real, each war persisted via an exactly-once `insertGvgWar()`
  claim. THE INSTANT a war resolves, the LOSING guild's every lineup team's
  lock is released (`claimReleaseGvgTeam` + `releaseGvgParty`, both
  idempotent) — the locked design decision: a knocked-out guild's monsters
  go home the moment it's eliminated, not at the event's end. Once the
  re-derived bracket comes back complete: `placements()` →
  `resolveRewards()` against the event's configured rewards, one idempotent
  `claimGvgTeamReward()` PER LINEUP TEAM (participants, not the whole
  roster) granting through the SAME `REWARD_GRANTERS` registry tournaments
  use (lifted out to `server/services/eventRewards.js` the moment GVG
  needed it too) and releasing that team's lock (a no-op for an
  already-eliminated guild, finally freeing the champion's), THEN
  `claimCompleteGvgEvent()` stamps the standings JSONB and flips
  `running -> completed`. Admin cancel mid-`running` still works unchanged:
  whichever guarded status flip lands first wins the race.
- ✅ Results: `GET /api/guild/gvg/detail?id=` (`getGvgDetail()`) returns the
  event summary, every registered guild's display info, a `teams` map
  (gvg_teams id -> guildId/trainerId/trainerName/display — display data
  only, never lanes) built by reading each registered guild's lineup
  exactly once and reusing it for both that map and the standings' reward
  lines, the war bracket re-derived round by round (each pairing's seed,
  per-battle summary, tiebreak flag), the 3rd-place pairing, the enriched
  standings, and the caller's own guild id. The 🏰 panel's GVG history rows
  gained a "Details" button swapping the panel body for this view
  (`src/ui/guild.js`, re-instantiating `src/ui/tournament.js`'s own bracket/
  standings view almost verbatim): round labels ("Round N" / "Semifinals" /
  "Final" / "3rd-place war"), byes as "bye", unplayed pairings "pending",
  and a per-war battle-summary list (one text line per battle — "Battle N:
  X's team vs Y's team — winner wins (N alive)", "both teams fall" for a
  draw, a tiebreak note — no cutscene replay, the Adventure precedent).
- ✅ Docs: GAME_DESIGN §6.4 and ARCHITECTURE's data-model/API sections, plus
  CLAUDE.md, updated to the shipped shapes in this same change.

**Done when:** two real guilds register lineups; after the window a plain
read resolves wars round by round exactly once (racing reads safe); the
relay carry-over is visible in results (a weakened survivor starts the next
battle at its carried HP); positions and percentile tiers pay guild
participants exactly once; eliminated guilds' monsters free immediately;
the full event is browsable afterward and replayable from stored seeds.

## Phase 10 — Trainer & battlefield QoL

Three quality-of-life gaps surfaced by playtesting Phases 0–9, staged
2026-07-07 as sub-phases 10.1–10.3, each independently shippable. None of
them needs a new serverless function (CLAUDE.md §5: the two QoL endpoints
ride the existing `admin` and `battle` domains; 10.3 is client-only), and
none touches the engine — no golden-log churn anywhere in this phase.
Order rationale: the admin gold editor (10.1) is a small, isolated
backend-plus-console slice proving nothing new; the battle party picker
(10.2) is the one real gameplay change and lands before the menu redesign
so the battlefield's final control set is known; the grouped menu bar
(10.3) is pure presentation over ids that already exist, so it goes last
and re-homes every button exactly once.

Three MORE sub-phases (10.4–10.6) were staged 2026-07-08 from playtest
feedback on the Phase 10.2/10.3 battlefield controls: a match-creation
option that keeps the current enemy (so re-fielding a party stops
re-rolling the opponent), a "Me & Team" menu group with a drag-and-drop
Setup Team panel replacing the battlefield party strip, and a
monster-centric Setup Monster gear panel. Order rationale: 10.4 goes
first because it's the one server change and both panels' Save action
depends on it; 10.5 goes before 10.6 because it creates the menu group
10.6's button lives in. 10.5 and 10.6 are client-only, 10.4 adds no new
serverless function (rides the existing `battle` domain), and none of the
three touches the engine.

Two MORE sub-phases (10.7–10.8) were staged 2026-07-08 (same day, immediate
feedback on 10.4–10.6's first playtest): the app moves from stacked,
independently-toggled panels to ONE view at a time (a panel opens → the
battlefield and every other panel hide), Playground becomes a direct menu
button that IS the battlefield view with its battle controls returning to a
row under the battlefield, and the Setup Team panel graduates from text
chips to battlefield-style unit cards with a click-for-detail area. Order:
10.7 first (the view switcher rehomes the battle controls 10.8's detail
area assumes stay put); both are client-only, engine untouched.

### Phase 10.1 — Admin: edit a trainer's gold ✅ CODE COMPLETE (2026-07-07)

The 👥 Trainers tab can already read every account and manage rosters, but
gold can only be *granted relative to itself* via items; there's no way to
set an account's balance outright.

- ✅ `POST /api/admin/trainers/update {trainerId, gold}` — a new row in the
  admin domain's router table (`server/routes/admin.js` +
  `server/routers/admin.js`, NOT a new serverless function). Admin-gated
  exactly like every other admin write (`server/services/admin.js`).
  Validation: `trainerId` names a real trainer; `gold` is an integer ≥ 0.
  Semantics: an absolute SET (the admin states the balance), deliberately
  unlike `POST /api/admin/grant`'s relative credit — one guarded UPDATE in
  `server/repos/trainers.js`, returning the refreshed trainer row.
- ✅ UI: the 👥 Trainers tab's "Manage" view (`src/ui/admin.js`) gains an
  editable gold field + Save next to the trainer's header info,
  re-rendering from the endpoint's response like every other admin write;
  the roster list's gold column refreshes on return.

**Done when:** an admin opens Manage on any account, types a new gold
amount, saves, and the header chip on that account's next `/api/trainer/me`
read shows exactly that balance; a non-admin calling the endpoint gets 403;
`gold:-5` or a fractional value gets 400.

### Phase 10.2 — Battlefield: pick your party ✅ CODE COMPLETE (2026-07-07)

Today `createMatch` (free) and `createPvpMatch` (attacker side) both take
`available.slice(0, TEAM_SIZE)` — a trainer with five monsters can never
field #4 or #5. The client should choose WHICH three fight (a choice, per
CLAUDE.md §1.1 — ids the server re-validates, never stats), while the
server keeps assembling everything else about the snapshot.

- ✅ `POST /api/battle/match` accepts an optional `monsterIds` (both modes;
  free and `mode:"pvp"` attacker) — a new pure `pickParty()` helper
  (`server/services/matches.js`) both `createMatch` and `createPvpMatch`
  call. When present: exactly 3 distinct integer ids, every one owned by
  the caller and not busy — the same validation ladder `saveDefense` runs
  plus the busy check `createMatch` already applies, 400/409 otherwise.
  When absent: today's first-3 behavior, byte-for-byte backward
  compatible. The chosen ORDER is the initial lane order; the existing
  drag + `playerOrder` permutation gate at resolve is unchanged (picker
  chooses members, drag refines order).
- ✅ A match stays frozen at creation (CLAUDE.md §1.6): changing the party
  after a match is open simply opens a fresh match via the same endpoint —
  exactly what "New Opponent" already does.
- ✅ UI: a new `src/ui/party.js` module owns a party strip on the
  battlefield (`#partyStrip`, between the battle controls and the drag
  hint) listing every owned monster (the adventure/tournament
  party-picker row shape; busy monsters disabled with their `busyKind`
  label), the current three (read off `state.armyA`'s `monsterId`s)
  highlighted. Picking a full, different 3 reveals a "Field this party"
  button; clicking it remembers the choice in module memory and asks
  `main.js` (via a callback) to open a fresh match with it — reused by
  Reset-after-a-battle, "New Opponent", and Ranked Battle alike, since all
  three already funnel through the same `openMatch()`. A "Default party"
  control appears whenever a non-default pick is remembered (including
  right after a failed attempt), reverting to the server's first-3-available.

**Done when:** a trainer with 5 monsters fields any 3 of them in a free
match and a PVP attack, in the order picked; a busy monster can't be
picked; sending someone else's monster id, a duplicate, or 2/4 ids gets
400/409 and no match row; omitting `monsterIds` still works exactly as
before.

### Phase 10.3 — Menu bar: grouped navigation ✅ CODE COMPLETE (2026-07-07)

Client-only. The flat 14-button `.controls` row (index.html) is replaced
by a horizontal menu bar above the battlefield, left to right, with
groups opening on hover AND on press (the viewport meta says touch
matters — click toggles, hover previews):

- ✅ **Playground** — Start Battle · Reset · New Opponent · Cinematic: On
- ✅ **Inventory** — direct button (opens the 🎒 panel)
- ✅ **Activities** — Farm · Trainer · Adventure
- ✅ **Battlefield** — Arena · Tournament · Guild
- ✅ **Summon** — direct button
- ✅ **Marketplace** — direct button
- ✅ **Admin** — direct button, hidden unless `is_admin` (existing behavior)

Every existing button id (`startBtn`, `resetBtn`, `shuffleBtn`, `cineBtn`,
`farmBtn`, `pvpBtn`, `trainerBtn`, `inventoryBtn`, `summonBtn`,
`adventureBtn`, `marketBtn`, `tournamentBtn`, `guildBtn`, `adminBtn`)
survived the move unchanged, so `src/main.js` and every panel's wiring keep
working; the new dropdown behavior lives in a new `src/styles/menu.css`
(imported from `main.js` right after `board.css`) plus a small new
`src/ui/menubar.js` (`initMenubar()`, DOM-only: click toggles one group at
a time via a shared `.open` class, one document-level listener closes
everything on an outside click or Escape, hover-open is CSS-only via
`@media (hover:hover)`). Disabled states (`resetBtn` disabled until a
battle ran) still render legibly inside a dropdown (the existing global
`opacity:.4` on `:disabled`).

**Done when:** every panel and battle control is reachable through the
grouped bar with both mouse hover and touch press; nothing else changed —
`npm run build` passes and no server file is touched. ✅ Verified: all 14
button ids resolve exactly once in `index.html`, `npm test` (197 passing)
and `npm run build` both pass, and no file under `server/` or `shared/`
changed.

### Phase 10.4 — Keep the enemy: re-field your party without a re-roll ✅ CODE COMPLETE (2026-07-08)

Context: today every party change opens a brand-new match via `POST
/api/battle/match`, which always re-rolls the enemy team and order —
"Field this party" (10.2) therefore shuffles the opponent as a side
effect. The fix: an optional `keepEnemyMatchId` body field (free matches
only). When present, the server validates the id names the CALLER'S OWN
match (404 "match not found" otherwise, same wording as resolve's gate)
of `kind='free'` (409 otherwise), and freezes the NEW match with that
match's `defender_snapshot` verbatim instead of a fresh random species
team — the attacker side, seed, and everything else assemble exactly as
today. Still a pure choice per CLAUDE.md §1.1: the client only ever names
a match id it already owns; stats stay server-frozen. `mode:"pvp"` +
`keepEnemyMatchId` is 400 (a PVP defender comes from matchmaking, never by
request).

- ✅ `POST /api/battle/match` gains the optional `keepEnemyMatchId` field
  (free mode only), validated and applied in `server/services/matches.js`.
- ✅ Client: "Field this party" and Reset-after-a-battle both pass the
  current match's id as `keepEnemyMatchId` (when the current match is a
  free one), so both become "same enemy, new lineup / rematch"; a NEW
  `🎲 New Enemy` button on the right side of the battlefield (in the enemy
  army's label) re-rolls ONLY the enemy — it opens a fresh match WITHOUT
  `keepEnemyMatchId`, sending the CURRENT board lane order as
  `monsterIds` so your team and arrangement carry over. The Playground
  menu's "New Opponent" stays as-is.

**Done when:** fielding a different 3 monsters keeps the exact same enemy
team and order; 🎲 New Enemy changes only the enemy; passing another
trainer's match id (or a pvp match's) as keepEnemyMatchId gets 404/409
and no match row; omitting the field behaves byte-for-byte as before. ✅
Verified: `npm test` (197 passing — no new pure logic was introduced;
`createMatch`'s keepEnemyMatchId gate is only exercised through an async
DB-backed service, and no sql-stubbing test harness exists yet for it,
same gap noted for `resolveMatch`) and `npm run build` both pass; no file
under `shared/engine/` or any golden fixture changed.

### Phase 10.5 — Me & Team: drag-and-drop Setup Team panel ✅ CODE COMPLETE (2026-07-08)

Context: the 10.2 party strip lives ON the battlefield and is
click-toggle only; team setup deserves its own home. A new LEFTMOST menu
group "Me & Team" (before Playground) holds 🪖 Setup Team plus the
relocated 🎒 Inventory button (10.6 adds Setup Monster between them). New
`src/ui/team.js` + `src/styles/team.css` + a `#teamPanel` msgs+body panel
shell (the Summon/Adventure precedent) REPLACE `src/ui/party.js` and the
`#partyStrip` battlefield strip (module deleted, `.party-*` CSS removed
from board.css).

- ✅ Panel layout: a top row of 3 numbered slot drop-zones (the next match's
  lane order), a bottom horizontally-scrollable row of EVERY owned
  monster (busy ones disabled with their busyKind label, the 10.2 chip
  data reused), pointer-event drag-and-drop in the dragdrop.js style
  (roster card → slot assigns/replaces, slot → slot swaps, an ✕ clears a
  slot; clicking a roster card drops it into the first empty slot as the
  touch fallback), a sort bar over the roster (Order = acquisition/id,
  Name, Power = str+agi+vit+int+dex since monsters have no level — each
  asc/desc), and a footer with **Save team** (enabled at exactly 3 slots;
  remembers the pick and opens a fresh match with `keepEnemyMatchId`,
  10.4 — same-enemy, new lineup), **Reset** (clears all three slots
  client-side only), and **Default party** (whenever a non-default pick
  is remembered — reverts to the server's first-3, same as 10.2).
- ✅ `getPartyIds()` moves to team.js so PVP/Ranked and every other
  `openMatch()` caller keeps reading the remembered party unchanged.

**Done when:** the team is assembled entirely by drag and drop, sorted
every way, saved (battle board re-renders with the new lineup vs the SAME
enemy) and reset; the old party strip is gone; ranked battle still uses
the remembered party; `npm run build` passes with no server/ or shared/
change. ✅ Verified: `grep -c 'id="inventoryBtn"'`/`'id="teamBtn"'` in
index.html both return 1, `grep -rn "party.js|partyStrip|renderParty|
initParty" src/ index.html` returns no hits, `npm test` (197 passing) and
`npm run build` both pass, and `git diff --stat` for this round touches no
file under `server/` or `shared/`.

### Phase 10.6 — Me & Team: Setup Monster panel ✅ CODE COMPLETE (2026-07-08)

Context: equipping today is item-centric (the 🎒 Inventory panel's
Equipment/Runes tabs pick a monster per piece); a monster-centric view is
the natural complement. A new 🐾 Setup Monster button in the Me & Team
group + `#monsterSetupPanel` (msgs+body shell) + `src/ui/monsterSetup.js`
(+ a small `src/styles/monsterSetup.css`): a chip row picks one owned
monster; the view shows its attrs and TWO sections — "Equipped" (its
monster-domain gear with Unequip, its socketed runes with charges and
Unsocket) and "Bag" (unequipped monster-domain gear with
Equip-onto-this-monster, unsocketed unbroken runes with Socket, honoring
the species' rune_slots server-side). ZERO new endpoints: everything
rides `fetchInventory`/`loadFarm` reads and the existing
`equipMonsterEquipment`/`socketRune` actions, re-rendering from each
response exactly like ui/inventory.js's runAction. Trainer-domain gear
stays in the Inventory panel (it isn't a monster's).

- ✅ Panel layout: a `.ms-picker` chip row over every owned monster
  (click to select, kept across re-renders), a `.ms-head` with the
  selected monster's emoji/name/class/element and an attrs line, and two
  `.ms-section`s ("Equipped"/"Bag") of `.ms-row`s mirroring
  `ui/inventory.js`'s `.inv-row` shape for equipment/rune display plus
  one action button each (Equip/Unequip, Socket/Unsocket). A broken
  unsocketed rune shows a BROKEN badge with no Socket button and a
  "repair it in the 🎒 Inventory panel" hint instead.
- ✅ Every action (`runAction`) disables its button, calls
  `equipMonsterEquipment`/`socketRune`, and re-renders straight from the
  refreshed inventory the server hands back — no gold moves here, so no
  profile refresh is needed.

**Done when:** a full gear/rune loadout can be assembled and stripped
from one monster's screen alone; every failure (no free rune slot, broken
rune) surfaces the server's message; client-only diff. ✅ Verified:
`grep -c 'id="monsterSetupBtn"'` in index.html returns 1, `npm test` (197
passing) and `npm run build` both pass, and `git diff --stat` for this
round touches no file under `server/` or `shared/`.

### Phase 10.7 — One view at a time: Playground button & exclusive panels ✅ CODE COMPLETE (2026-07-08)

Context: 10.3's menu bar toggles each panel independently, so panels stack
under the battlefield and it's unclear "where" you are; the Playground
dropdown's four controls (Start Battle / Reset / New Opponent / Cinematic)
also read oddly as menu items for what is really THE main screen. Changes:

- ✅ A tiny new `src/ui/views.js` view registry: `registerView(name, {button,
  el, onShow})` wires the menu button itself; `showView(name)` hides every
  other registered view's element, shows the target, and runs its `onShow`
  (each panel's existing refresh-on-open). Clicking an already-open view's
  button just refreshes it; nothing "toggles closed" anymore — you leave a
  view by entering another. Static button labels (the "Close X" text-flip
  dies with the toggles).
- ✅ All 12 panel modules (team, monsterSetup, inventory, farm, trainer,
  adventure, pvp, tournament, guild, summon, marketplace, admin) swap their
  private `toggle()` for one `registerView` call — same refresh behavior,
  less code per module.
- ✅ index.html: the Playground menu-group is replaced by a direct
  `🏟 Playground` button (`#playgroundBtn`); a new `#playgroundView` wrapper
  groups the battlefield (`.field-frame`), a NEW `#battleControls` row
  placed UNDER the battlefield holding the four existing control buttons
  (ids unchanged: startBtn/resetBtn/shuffleBtn/cineBtn — the pre-10.3 flat
  controls row reborn, below the field this time), the drag hint, and the
  battle log (relocated inside the wrapper). Registered as the `playground`
  view; visible by default, shown again via the button or automatically
  after actions that put a new match on the board from inside a panel
  (Ranked Battle, Save team).

**Done when:** entering any panel hides the battlefield and every other
panel; entering Playground hides all panels and shows board + controls +
log; Start/Reset/New Opponent/Cinematic all work from the new row; ranked
battle from the Arena panel lands you on the battlefield; `npm run build`
passes, no server/ or shared/ change. ✅ Verified: `grep -c 'id="startBtn"'`/
`resetBtn`/`shuffleBtn`/`cineBtn`/`playgroundBtn`/`logLines` in index.html
each return 1, `grep -rn 'addEventListener("click", toggle' src/ui/` returns
0 hits, `npm test` (197 passing) and `npm run build` both pass, and
`git diff --stat` for this round touches no file under `server/` or
`shared/`.

### Phase 10.8 — Setup Team: battlefield cards & unit detail ✅ CODE COMPLETE (2026-07-08)

Context: the 10.5 panel renders monsters as text chips; the battlefield
renders them as proper unit cards (sprite portrait, HP bar, ATK/SPD
plate). The panel should speak the same visual language, and clicking a
unit should tell you about it. Changes:

- ✅ `src/ui/board.js` exports a new `unitCardEl(u, posLabel)` — the pure card
  builder extracted verbatim from today's private `buildCard()` (markup +
  portrait mount, no drag/dataset/front-marker concerns); `buildCard()`
  becomes a thin decorator over it. Battle rendering byte-for-byte
  unchanged.
- ✅ `src/ui/team.js` renders BOTH the three lane slots and the roster row as
  those unit cards. Display stats come from `deriveStats(m.base, m.attrs)`
  imported from `shared/rules/formulas.js` — the SAME pure function the
  server's snapshot uses (shared/ is importable by src/ by design, CLAUDE.md
  §3); display-only, full HP, never sent anywhere.
- ✅ Clicking any card (slot or roster; the drag threshold already separates
  click from drag) opens a `.team-detail` area inside the panel: portrait,
  name, class/element/attack kind/style/targeting, the derived stat line
  (HP, ATK or MATK range, SPD, CRIT/EVA/ACC), attributes, the skill list
  (name + level), busy state — plus action buttons ("Set as lane 1/2/3",
  "Remove from team" when slotted), which REPLACE 10.5's tap-to-place as
  the no-drag path (on touch, tap = detail, place from there). Drag-and-drop
  keeps working exactly as in 10.5; roster cards override the unit card's
  `touch-action:none` with `pan-x` so the row still scrolls horizontally on
  touch while a vertical drag up to the slots stays a drag.

**Done when:** slots and roster read like the battlefield; clicking a unit
shows its full detail and can place/remove it; drag still assigns and
swaps; the roster still scrolls; client-only diff. ✅ Verified: `npm test`
(197 passing) and `npm run build` both pass; `grep -rn
"team-slot-chip\|team-card-emoji\|onRosterCardClick" src/` returns 0 hits;
`git diff --stat` for this round touches only `src/ui/board.js`,
`src/ui/team.js`, `src/styles/team.css`, and docs (`CLAUDE.md`,
`docs/ROADMAP.md`) — no `server/`/`shared/` change.

## Phase 10.9 — Monster rank, power & the redesigned unit card + Adventure picker parity ✅ CODE COMPLETE (2026-07-10)

Staged 2026-07-10 from playtest feedback: the unit card (battlefield,
Setup Team, Adventure/Tournament/Guild party pickers) shows raw derived
stats and nothing about how "good" a monster is at a glance. Three slices,
each independently shippable:

- **Foundation (this round, server + shared + data + admin only):** a
  closed, ascending RANK ladder (`shared/rules/ranks.js`, D → C → B → A →
  S → SR → SSR) on both `monster_species` (the master baseline) and
  `monsters` (an owned instance's own, admin-editable, meant to become
  player-upgradeable later); a display-only `powerScore()`
  (`shared/rules/formulas.js`) derived from `deriveStats()` output — a
  placeholder formula to rebalance later, never an engine input; every
  monster/species read now also carries `equipmentCount`/`runeCount` so a
  future card can show gear-at-a-glance without a second round trip. Admin
  console: species get a rank field, and the Trainers tab's per-monster row
  gets a rank editor (`POST /api/admin/monsters/update`).
- ✅ **The redesigned unit card (client-only round, 2026-07-10):**
  `ui/board.js`'s `unitCardEl()` plate is now a header row (a
  `classIconEl()`-built class-icon tile with a native `title` tooltip,
  replacing the old text class label, sourced from
  `public/icons/classes/<class>.png|svg` with a `default.svg` fallback —
  swappable art, no code change, see that dir's README), a centered name,
  and — only when the lane carries a `rank` — a rank badge + `powerScore()`
  number (imported from `shared/rules/formulas.js`); an HP row; and a 2x2
  stat-tile grid (atk range, SPD, socketed-rune count, equipped-gear count,
  reading `runes`/`equipment` arrays on battle lanes or
  `runeCount`/`equipmentCount` on roster rows). A `rank-<tier>` modifier
  class drives a per-rank `--rank-color` (`src/styles/board.css`) on the
  card's border/badge/power text, with a glow on S/SR/SSR; unranked lanes
  (old snapshots) render with no rank block and the prior default border.
  `ui/team.js`'s Power sort now reuses the identical `powerScore()` number
  the card shows. Client-only — no `server/`/`shared/` change this round.
- ✅ **Adventure picker parity (client-only round, 2026-07-10):** the Setup
  Team panel's slots-over-roster widget (drag-and-drop lane slots, the
  sortable card row, the click-for-detail area, and the pointer-drag
  machinery) is EXTRACTED out of `ui/team.js` into a new
  `ui/partyPicker.js` — a `createPartyPicker({monsters, initialSlots,
  onChange})` factory returning `{el, getSlots, setSlots, setMonsters}` so
  two panels can each host an independent instance. `ui/team.js` becomes a
  thin host: it still owns the roster read, the remembered party ids, and
  the Save team / Reset / Default party footer, but builds a fresh picker
  instance every `refresh()` and reads `getSlots()` at save time.
  `ui/adventure.js` hosts a second instance in `renderSetup()` in place of
  the old plain-row `partyPicker()`/`togglePick()` — the SAME picker
  instance persists across `renderBody()` re-renders (its `onChange` only
  toggles each route's "Set out" button, never recreates the widget), and
  "Set out" sends `getSlots()` (lane order = pick order, front first,
  unchanged from the endpoint's perspective). CSS classes stayed `team-*`
  (styles/team.css is global, so the Adventure panel gets them for free);
  the now-dead `.adv-mon-*`/`.adv-pick-badge` rules in styles/adventure.css
  were removed. Client-only — no `server/`/`shared/` change this round.

**Done when (foundation round):** `shared/rules/ranks.js` exports the
closed RANKS list; `powerScore()` is covered by a golden-value test off a
known `deriveStats()` output; every monster/species repo read carries
`rank` (and owned-monster reads carry `equipmentCount`/`runeCount`);
`toLane()` freezes `rank` into the battle snapshot as display metadata only
(no engine branch reads it); the admin console can set a species' rank and,
per trainer, an individual monster's rank; `npm test` and `npm run build`
both pass with no golden-log diff (the engine itself is untouched). ✅ Done.

**Done when (redesigned-card round):** the card header shows a tooltipped
class icon, a centered name, and — when ranked — a rank-colored
badge/power/border/glow; the HP row and a 2x2 stat grid (atk/spd/runes/
gear) replace the old two-stat row; Setup Team's Power sort matches the
card's number; `npm test` (no diff) and `npm run build` both pass;
`git diff --stat` for this round touches only `src/`, `public/`, and docs.
✅ Done.

**Done when (Adventure-picker-parity round):** `ui/partyPicker.js` exports
`createPartyPicker()`; `ui/team.js`'s public exports/behavior are
byte-identical from the user's perspective; the Adventure panel's party
picker is the same drag-and-drop unit-card experience as Setup Team's, with
"Set out" gated on all 3 lanes filled; `npm test` (no diff) and `npm run
build` both pass; `git diff --stat` for this round touches only `src/` and
docs. ✅ Done. **Phase 10.9 is done.**

Refined 2026-07-10 after playtest: the unit card grew to 225px (tighter
inner padding, a min-height so tiles don't cramp), the class-icon tile
shrank to badge size with an element-name label under it (mirroring the
rank badge/power column), and the name never truncates — it auto-shrinks
through length-based size tiers instead of ellipsizing.

## Phase 10.10 — Setup Monster staging + farm slots ✅ CODE COMPLETE (2026-07-10)

Staged 2026-07-10 from playtest feedback, two independently shippable
rounds:

- ✅ **Setup Monster: card picker + staged Save (client-only round,
  2026-07-10):** the 🐾 Setup Monster panel's (`ui/monsterSetup.js`,
  Phase 10.6) text-chip picker row is replaced by a horizontally scrollable
  row of the shared `unitCardEl()` cards (the same battlefield-style card
  `ui/partyPicker.js` hosts) — click a card to select it, with a
  `ms-card-active` accent border/glow. Its Equip/Unequip/Socket/Unsocket
  buttons no longer fire the server immediately: each click stages a
  change into a local `Map<pieceId, targetMonsterId|null>` (one map for
  equipment, one for runes), keyed by piece id so switching the selected
  monster never discards a pending choice, and a piece's Equipped-vs-Bag
  section placement is its PROJECTED location (the map's override if
  present, else the server's own `monsterId`) — landing an override back
  on the server value deletes the entry rather than keeping a no-op change.
  Any row whose projected state differs from the server gets a "pending"
  badge. A footer Save/Discard bar applies every staged change SEQUENTIALLY
  over the existing `equipMonsterEquipment`/`socketRune` endpoints —
  unequips/unsockets first, freeing slots/capacity before the equips/
  sockets that follow — stopping on the first failed call (surfacing the
  piece's name plus the server's message, e.g. "no free rune slots") while
  leaving that op and everything after it staged for retry, and clearing
  both maps only once every op has landed. No client-side rune-slot
  precheck — the server still 409s at Save time, same stance as before
  this round. Client-only — no `server/`/`shared/` change.
- ✅ **Farm slots — server slice (server-only round, 2026-07-10):** a flat
  `MAX_FARM_SLOTS = 2` (`server/services/activities.js`) caps a trainer at 2
  concurrent unresolved activities, folded into the activity INSERT itself
  (`insertActivityCapped` in `server/repos/activities.js` — a
  precheck-then-act pair would race two simultaneous starts into the same
  last slot) rather than a separate precheck; losing that race compensates
  the busy lock `startActivity()` already claimed (LIFO, the `performSummon`
  precedent) before 409ing. A running job is now cancellable anytime for NO
  reward: `DELETE /api/activities {activityId}` (the bare route's new third
  method — a plain `api/activities.js` file can't grow a sub-path, so cancel
  rides a METHOD instead) claims the still-unresolved, not-yet-due row and
  frees the monster in one statement (`cancelActivity` in
  `server/repos/activities.js`); a job already past its `ends_at` is left
  for lazy settlement to pay out rather than raced into a reward-less
  cancel. `farmState()` now reports `farmSlots` alongside `jobs`/`active` so
  the client renders the cap from the server, never its own constant.
  `src/services/content.js` gained one client stub, `cancelActivity()`, for
  the UI round to wire up. Server-only — no `src/ui/` change yet.
- ✅ **Farm slots — UI round (client-only round, 2026-07-10):** the 🏕 Farm
  panel (`ui/farm.js`) is rewritten from a per-monster row list into a
  slot-based layout, all still rendered inside the existing `#farmList`
  container: a slots row on top — one box per the server-reported
  `farmSlots` (occupied: the working monster's shared `unitCardEl()` card,
  its job, the countdown, and a confirm-gated no-reward Cancel button
  wired to the new `cancelActivity()` stub; free: a drop target you can
  stage a monster + job into, then Send; plus one purely decorative locked
  box hinting at more slots later) — over a horizontally scrollable roster
  row of the same shared unit cards below. Staging is local, session-only
  state (`staged: (number|null)[]`, indexed by free-slot position,
  reconciled against the roster/active list on every server read); an
  available roster card is draggable onto a free slot (a pointer-drag
  pattern adapted from `ui/partyPicker.js`'s `beginPointerDrag`, targeting
  `.farm-slot.free` and reusing its globally-styled `team-drag-clone`/
  `drop-target` classes) or, for touch/no-drag, a plain click places it
  into the first empty free slot. `styles/farm.css`'s old per-row classes
  (`farm-row`/`farm-id`/`farm-emoji`/`farm-status`) are gone, replaced by
  `.farm-slots`/`.farm-slot` (occupied/free/locked)/`.farm-roster`;
  `.farm-count`/`.farm-btn`/`.farm-select` are unchanged. No `server/`/
  `shared/` change.

**Done when (card-picker round):** the picker row renders `unitCardEl()`
cards with click-to-select; Equip/Unequip/Socket/Unsocket stage into the
two pending maps instead of calling the server directly; a footer Save bar
applies every staged change in the documented order, stopping and
surfacing the server's message on the first failure while leaving the rest
staged; Discard clears both maps; `npm test` (no diff) and `npm run build`
both pass; `git diff --stat` for this round touches only `src/` and docs.
✅ Done.

**Done when (farm-slots server slice):** `startActivity()` 409s once 2
concurrent unresolved activities already exist, enforced inside the
activity INSERT itself (no precheck-then-act race) with a compensating
busy-lock release on a lost slot race; `DELETE /api/activities
{activityId}` cancels a still-running (not yet due) job for no reward and
frees the monster in one statement, leaving an already-finished job to lazy
settlement instead; `farmState()`/`GET`/`POST`/`DELETE /api/activities` all
report `farmSlots`; `npm test` and `npm run build` both pass;
`git diff --stat` for this round touches only `server/`, one line of
`src/services/content.js`, and docs. ✅ Done.

**Done when (farm-slots UI round):** the 🏕 Farm panel renders a slots row
(occupied/free/locked) from the server-reported `farmSlots`, sourced from
zero client-side constants; a free slot can be staged (drag or click) and
Sent, an occupied slot can be Cancelled (confirm-gated, no reward) via the
new endpoint; the roster row renders the same shared unit cards, busy ones
tagged and non-interactive; `npm test` and `npm run build` both pass;
`git diff --stat` for this round touches only `src/ui/farm.js`,
`src/styles/farm.css`, and docs. ✅ Done. **Phase 10.10 is done.**

## Phase 10.11 — Battlefield stack & chrome compaction (playtest) ✅ CODE COMPLETE (2026-07-10)

Staged 2026-07-10 from playtest feedback, client-only, two small fixes:

- **Compact header + one-line menubar:** the header's descriptive
  `<p class="subtitle">` line under the title is gone (`index.html`,
  `src/styles/base.css` — the now-dead `.subtitle` rule was removed too,
  confirmed to have no other consumer), and `header.top`'s own
  margin/padding shrank so the top bar sits noticeably lower with less
  vertical footprint. The menubar (`src/styles/menu.css`) is scoped tighter
  — a smaller gap (10px → 6px), smaller font/padding on its top-level items
  only (`.menubar > .btn` and `.menu-trigger`, NOT the `.menu-drop .btn`
  dropdown items, and NOT the global `button.btn` in base.css) — so it fits
  one line on a typical desktop width, with `flex-wrap:wrap` still the
  fallback on narrow windows.
- **Battlefield: stacked army rows.** Since the unit card grew to 225px
  (Phase 10.9), the old side-by-side desktop layout let the enemy row's
  HP/stats scroll out of view mid-battle. `src/styles/board.css` drops the
  `@media (min-width:760px)` side-by-side override entirely — `.army` is
  now a full-width card row (`flex-direction:row;flex-wrap:wrap`) with its
  `.army-label` pinned to its own line above the cards
  (`flex:0 0 100%`) at every width, so "My Units" and "Enemy Units" always
  stack vertically with the VS clash zone between them (`.clash`'s
  `min-height` trimmed 64px → 48px to keep the stack tight).
  `ui/board.js`'s `renderBoard()` now renders BOTH armies back-to-front
  (army B reversed too, matching army A), so each army's front-line unit
  sits rightmost, keeping lane 1 vertically aligned across the stack and
  both fronts nearest each other over the clash zone — reversing the
  visual order never touches lane data (`lane` still comes from
  `sourceArr.indexOf(u)+1`). The army labels themselves are renamed "My
  Units" / "Enemy Units" (were "Your Army" / "Enemy").

**Done when:** the header takes roughly half its old vertical space with
the subtitle line gone; the menubar's top-level items fit one row on a
typical desktop width; the battlefield renders "My Units" over "Enemy
Units" (VS zone between) at every width, both fronts aligned nearest the
clash zone; `npm test` (no diff — client-only) and `npm run build` both
pass; `git diff --stat` for this round touches only `index.html`,
`src/styles/base.css`, `src/styles/menu.css`, `src/styles/board.css`,
`src/ui/board.js`, and docs. ✅ Done. **Phase 10.11 is done.**

**Adjusted same day:** the two `.army-label` lines merged into one line in
the clash zone reading "● My Units  ⚔ VS  ● Enemy Units", between the
stacked army rows instead of atop each one; the 🎲 New Enemy re-roll button
was removed as redundant with New Opponent (Setup Team already remembers
the party); the idle status line ("Front line: lane 1") under the VS badge
was removed too — `#status` still stays (turn narration, errors, the
Victory/Defeat banner all render into it) but is now empty at rest, with
`.clash .status`'s `min-height` dropped so an empty status takes no
vertical space; and, per further playtest feedback, the enemy row's
front-liner is now leftmost rather than rightmost — `ui/board.js`'s
`renderBoard()` renders army B FRONT -> BACK (army A stays BACK -> FRONT),
so the two fronts (A1, B1) sit diagonally opposite across the VS row
instead of vertically aligned.

## Phase 10.12 — Graphics: PNG class icons + battle status icons ✅ CODE COMPLETE (2026-07-10)

Two client-only art slices, staged together:

- **Class icons go PNG-first.** `src/data/classes.js`'s `CLASS_META` gains
  an explicit `icon` field per class, naming a base filename under the new
  `public/icons/classes/` (64×64 transparent PNGs, one editable `.svg`
  source per icon kept alongside). `ui/board.js`'s `unitCardEl()` header row
  renders that PNG in the class-icon tile (via the new `classIconEl()`),
  falling back to the class name lowercased for a class not in the map,
  then to `default.png` if that art is missing too — a user can now swap
  class art by dropping in a same-named PNG, no code change.
- **Battle status icons.** A per-unit row of small PNGs along the TOP of the
  portrait, one per active status, filling left→right in the order gained.
  `src/data/statusIcons.js` (new) maps each status id from the closed
  registry in `shared/rules/statuses.js` to an icon base filename, mirroring
  `CLASS_META`'s `icon` field; art lives in the new
  `public/icons/statuses/` (same 64×64-PNG-plus-editable-`.svg` convention,
  same README shape, as the class icons). `unitCardEl()` renders a
  `.unit-status-row` inside `.unit-portrait-top` from `u.statuses ?? []`
  (guarded — non-battle callers like the party picker/Setup Team/farm never
  pass a `statuses` field, and render exactly as before); the replayer
  (`src/core/battle.js`) is the only thing that ever fills it live, via the
  new `updateCardStatuses()` export called from `replayStatus`/
  `replayStatusEnd` right after each event mutates `u.statuses` — pure
  display over state the replayer already tracked, no new math, engine
  untouched.

**Done when:** both icon sets render (a class-icon tile per unit card, a
top-of-portrait status row that grows/shrinks live as `status`/`status_end`
events replay); a missing icon file falls back to `default.png` for its set
without a broken image; `npm test` (engine goldens unmoved — this round
never touches `shared/engine/`) and `npm run build` both pass. ✅ Done.
**Phase 10.12 is done.**

Playtest follow-up (2026-07-10): a uniform 12px menu font (the dropdown
items now match the top-level buttons' size instead of the browser
default), status icons doubled to 28px for legibility, the class→icon
filename map promoted from client-only data (`CLASS_META.icon`) to a live
`classes.icon` column on the classes master table (migration
`020_class_icon.sql`, admin-editable with an image preview in the 🎭
Classes tab, served to the client via the existing `GET
/api/trainer/classes` read), and a read-only 💫 Statuses reference tab in
the admin console surfacing the engine's closed status registry's
id/label/icon-file mapping (statuses themselves stay engine data, never DB
rows).

## Phase 10.13 — Skill media: icons + the animation column ✅ CODE COMPLETE (2026-07-11)

Two new columns on the `skills` MASTER TABLE (migration `021_skill_media.sql`):
`icon` (a base filename under `public/icons/skills/`, the same class-icon-tile
idea applied per skill, with placeholder art for the three `normal`/
`ultimate`/`passive` slots plus a `default`) and `animation` (a full filename,
extension included, under `public/anim/skills/` — sample fixtures
`sample_slash.svg`/`sample_slash.png` demonstrate both branches). Both ride
every monster read's `skills[]` `json_agg` (party/farm/match snapshots
alike) and the admin `listSkillsAdmin`/`upsertSkill`/`validateSkill` path,
landing in a prior server round; this round is entirely client:

- **`src/ui/skillMedia.js` (new)** — the one owner of skill media
  rendering, mirroring `ui/board.js`'s `classIconEl()`/`fillStatusRow()`
  seam. Two independent lookup chains: the ICON chain
  (`skill.icon || skill.slot || "default"` → `/icons/skills/<base>.png`,
  the standard onerror-to-`default.png` loop-guarded fallback) via
  `skillIconEl()` (a DOM `<img>`) and `skillIconHtml()` (the same chain as
  an inline HTML string, for callers building log lines as raw HTML); and
  the ANIMATION chain, where the FILENAME'S EXTENSION picks the renderer —
  `.svg` → a self-animating `<img>` (the motion is authored inside the
  file), `.png` → a CSS sprite strip of square frames played via
  `steps(cols)` (the `ui/sprite.js` unit-sheet idiom, single row) — via
  `skillAnimationEl()`. New CSS in `styles/sprite.css`: `.skill-anim`
  (the sprite-strip idiom, `--cell`/`--sheet`/`--cols` custom props set by
  `skillAnimationEl()`) and `.skill-anim-svg` (a fixed size for the SVG
  case).
- **Party-picker detail.** `ui/partyPicker.js`'s `team-detail-skill` rows
  (the click-for-detail area shared by Setup Team and the Adventure party
  picker) now prepend `skillIconEl(sk, 16)` before the name/level text;
  `styles/team.css`'s `.team-detail-skill` picked up the minimal flex/gap
  to lay the icon and text side by side.
- **Battle log.** `core/battle.js`'s `replaySkill()` resolves the firing
  skill off the live unit's `skills[]` (`u.skills?.find(s => s.id ===
  ev.skill)`, present because `makeUnit()`'s spread already preserves
  every lane field) and prepends `skillIconHtml()`'s inline `<img>` to the
  log line — string building only, the replayer stays math-free. A new
  `.log-skill-icon` rule sits next to the rest of the log's styles in
  `styles/base.css`.
- **Admin ⚔ Skills tab.** List rows gain a small icon (26px, the
  icon/slot/default chain) via a generalized `iconImg(dir, base, title,
  size)` helper in `ui/admin.js` — refactored out of the Classes tab's
  former `classIconImg()` so both tabs share one image-with-fallback
  builder (`dir:"classes"` / `dir:"skills"`). The skill edit form gains
  two text inputs, `icon` and `animation`, each with a live preview: the
  icon preview repaints on icon/slot input through the same `iconImg()`
  helper; the animation preview repaints on input, showing "no animation"
  when empty or `skillAnimationEl()`'s rendered element plus its resolved
  `/anim/skills/<file>` path otherwise. Two `adm-hint` lines document both
  fields' folders and the extension rule. The new-skill template gains
  `icon: null, animation: null`.

**Done when:** a monster's skills render icons in the party-picker detail
and the battle log narrates each skill cast with its icon; a missing icon
file falls back to `default.png` without a broken image; the admin Skills
tab can set/preview both fields live; `npm test` and `npm run build` both
pass (this round never touches `shared/engine/` or the server — no golden
regen needed). ✅ Done. **Phase 10.13 is done.**

## Phase 10.14 — Interactive adventure battles + party-picker pool ✅ CODE COMPLETE (2026-07-11)

Staged 2026-07-11 from playtest feedback, three independently shippable
rounds: today an Adventure battle node auto-resolves the instant it's
picked, with no player agency in lane order, and its loot/catch grant
mid-run even though the whole run might still be lost later. This phase
makes battle nodes an actual two-phase fight and escrows every reward until
the run is actually won.

- ✅ **Interactive battles + reward escrow — server slice (server-only
  round, 2026-07-11):** picking a battle option in `move()`
  (`server/services/adventure.js`) no longer auto-resolves it — it STAGES
  the fight: rolls 1-3 wild enemies (the route's new optional
  `config.enemies:{min,max}` knob, `server/services/adminValidate.js`'s
  `validateAdventureConfig`, defaulting to `{min:1,max:3}`) via
  `rollEncounter()` and freezes them into a new `pending_battle` jsonb
  column (`022_adventure_pending_battle.sql`) via a new exactly-once claim,
  `claimStageBattle()` (`server/repos/adventures.js`) — the `claimAdvance`
  role, minus advancing `position`, since a staged fight still occupies the
  current step. Two new domain endpoints ride the existing `adventure`
  router: `POST /api/adventure/battle {order}` resolves the staged fight
  with the player's own lane order (`applyOrder()`, the exact permutation
  gate `battle/resolve` uses, imported from `services/matches.js`) against
  the frozen `nodeSeed`, claims the settlement exactly once
  (`claimSettleBattle()`, the `claimResolve`-style "one guarded UPDATE
  clears pending_battle, advances position on a win, flips a terminal
  state, appends the log entry" claim), then fires post-claim rune wear
  (win or lose, the `resolveMatch` precedent) and — only once the run
  actually reaches `'completed'` — grants every escrowed reward via a new
  `grantRunRewards()`; `POST /api/adventure/surrender {}` is a defeat with
  no order to validate, forfeiting everything staged. A session with a
  battle already staged 409s any further `move()` call ("resolve the staged
  battle first") — battle/surrender are the only moves left. Loot/catches
  are no longer granted mid-run at all: chest/gather resolvers
  (`NODE_RESOLVERS`) now only log `{loot:[...]}}`, and `grantRunRewards()`
  (called from `battle()`/the now-unreachable-but-harmless chest/gather
  completion path) is the ONE place items get granted and catches get
  minted, walking the session's whole `loot` log at once — a defeat,
  surrender, abandon, or lazy expiry forfeits every escrowed entry, since
  nothing before `'completed'` ever calls it. `toSessionView()`'s new
  `pendingBattle` key ships both sides' frozen lane snapshots for the
  staged fight (the same disclosure level `POST /api/battle/match`'s
  `you`/`enemy` already sets) and forces `options: null` while a battle is
  pending. Server-only — no `src/ui/` change yet (the panel still only
  calls `move()`, so a battle node currently reads as staged-but-never-
  resolved until the client round below wires the new endpoints in).
- ✅ **Battlefield scene — client slice (2026-07-11):** picking (or
  resuming) a staged Adventure battle now cuts to the REAL battlefield —
  no separate scene of its own. The Adventure panel (`ui/adventure.js`)
  never replays events itself; it hands `session.pendingBattle` off through
  an injected `enterBattle` hook (the `initPvp(startRankedBattle)`
  precedent — the panel never imports `main.js`), which main.js's new
  `enterAdventureBattle()` turns into `core/state.js`'s new
  `loadAdventureBattle()` (the same toLane()-shaped `you`/`enemy` snapshot
  load `newMatch()` does, setting a new `state.adventureBattle:{position}`
  marker and clearing `matchId`/`opponent`) before switching to the
  Playground view. `runBattle()` (`core/battle.js`) branches on
  `state.adventureBattle`: an adventure fight resolves through
  `resolveAdventureBattle()`/`POST /api/adventure/battle` instead of
  `requestBattle()`, replays the identical event log either way, and now
  RETURNS its result (`{youWin, events, survivor, adventure:{session,node}}`)
  so main.js can act on it. A new battle-controls row pair —
  `#surrenderBtn`/`#continueBtn` in `index.html`, synced by main.js's new
  `updateBattleControls()` — swaps Reset/New Opponent out for Surrender
  while an adventure fight is staged (posts to `/api/adventure/surrender`,
  confirm-gated, a defeat that forfeits every escrowed reward) and reveals
  Continue once `onStart()` sees the battle end
  (`state.adventureBattle && state.phase === "over"`); Continue hands the
  fresh session back to the panel (`noteAdventureBattleResult()`, a new
  `ui/adventure.js` export) and returns to the Adventure view, which
  resumes correctly whether that session is still active (next step) or
  just went terminal (see below) — including on a plain page refresh, since
  `refresh()` now renders a "To battle" notice + enemy chips straight off a
  re-fetched `pendingBattle` instead of the old (now-impossible) inline
  battle option. The terminal summary (`renderTerminal()`) gained a
  headline for a surrendered run, an explicit "What you brought home"
  section (item qtys summed + catches, from the same escrowed `loot` log
  `grantRunRewards()` reads) on a completed run vs. a one-line "everything
  was forfeited" hint otherwise, and its button is now "End Adventure".
- ✅ **Party-picker pool trim (2026-07-11):** `ui/partyPicker.js`'s roster
  row now shows only the REMAINING pool — a monster already placed in a
  lane is skipped entirely rather than rendered dimmed-with-a-badge, so at
  a glance the row below the slots is always exactly what's still
  available to pick (duplicates were already impossible via
  `assignToSlot`; this round is about clarity, not correctness). The now-
  dead `.team-roster .unit-card.slotted` CSS rule (nothing sets that class
  in a `.team-roster` any more) was removed from `styles/team.css`;
  `.team-card-badge` stays — `ui/farm.js`'s slot picker still uses it.
  Shared picker, so both hosts (Setup Team, Adventure) pick this up with
  no host-file changes.

**Done when:** picking a battle option stages 1-3 enemies into
`pending_battle` instead of resolving instantly; `POST /api/adventure/battle
{order}` resolves it with a validated lane-order permutation and grants
every escrowed reward only once the run completes; `POST
/api/adventure/surrender {}` fails the run and forfeits everything staged;
chest/gather loot is logged but not granted until completion; a staged
Adventure battle plays out on the real battlefield (Surrender/Continue
controls, a terminal "What you brought home" summary); the shared party
picker's pool row shows only unplaced monsters; `npm test` and `npm run
build` both pass (no `shared/engine/` change, no golden regen). ✅ Done.
**Phase 10.14 is done.**

## Phase 10.15 — Mobile & touch friendliness

Staged 2026-07-11 from playtest feedback on a phone (Android Chrome): unit
cards carried `touch-action:none` and every pointer-drag implementation
started a drag after only 5px of movement, so on a touch screen a finger
landing on ANY card got captured — with cards this big, there was barely any
empty space left to scroll a row or the page at all. Two independently
shippable rounds:

- ✅ **The shared hold-to-drag/swipe-to-scroll engine ✅ CODE COMPLETE
  (2026-07-11):** a new `src/ui/pointerDrag.js` — the one drag-gesture
  engine behind every drag surface in the game, extracted from the three
  near-identical implementations that used to live in `ui/partyPicker.js`
  (the most complete: threshold, clone, drop-target class, pointercancel
  teardown), `ui/farm.js` (a near-verbatim copy), and `ui/dragdrop.js` (the
  older, immediate-on-pointerdown battlefield swap, upgraded onto the same
  engine in this round). `beginPointerDrag(e, {sourceEl, findTarget,
  onDrop, cloneClasses})` is called straight from a `pointerdown` handler
  and owns the rest of the gesture itself. The new interaction model,
  uniform across every site: **mouse** unchanged (a small movement
  threshold before a drag starts, `preventDefault()` on the pointerdown
  itself); **touch/pen** drags only after a ~300ms press-and-hold with the
  finger inside a ~10px slop — moving past the slop before the hold fires
  cancels the pending drag outright and lets the browser scroll, and a
  native `pointercancel` (the browser independently deciding this is a pan)
  tears down the exact same way. A completed hold "lifts" the card
  (`navigator.vibrate?.(15)`, the clone appears) and, since `touch-action`
  can't change mid-gesture, wires a window-level NON-PASSIVE `touchmove`
  listener that calls `preventDefault()` for the rest of the gesture — the
  standard way to keep an already-lifted drag from being hijacked as a
  scroll. `partyPicker.js`/`farm.js`/`dragdrop.js` all now call the shared
  engine instead of hosting their own copy; `dragdrop.js`'s battlefield
  swap picked up the same threshold/hold split it never had before (it used
  to lift immediately on pointerdown with zero threshold at all). CSS: the
  `touch-action` flip — `styles/board.css`'s `.unit-card` flips
  `touch-action:none` → `pan-x pan-y` (the actual root cause — `none` told
  the browser to hand every touch straight to JS with no native panning at
  all) and adds `-webkit-touch-callout:none` next to its existing
  `user-select:none` (stops iOS's long-press callout menu from fighting the
  same hold). The three per-site overrides that used to exist only to
  *re*-allow `pan-x` on top of the old blanket `none` (`styles/team.css`'s
  `.team-roster .unit-card`, `styles/farm.css`'s `.farm-roster .unit-card`,
  `styles/monsterSetup.css`'s `.ms-cards .unit-card`) are now redundant —
  `.unit-card` itself is scrollable by default — and were simplified down
  to just their non-touch-action rules (`flex:0 0 auto` etc.), with their
  stale comments rewritten for the new model. Touch hints, coarse-pointer-
  only via a new `base.css` utility pair (`.touch-hint`/`.mouse-hint`,
  gated on `@media (pointer:coarse)`): the battlefield's `#hint` now
  carries both a `.mouse-hint` span (the existing drag copy) and a
  `.touch-hint` span ("✋ Hold a unit to pick it up · swipe to scroll");
  `ui/partyPicker.js` and `ui/farm.js` each render one small hint line of
  their own (`team-hint touch-hint` / `farm-hint touch-hint`) directly
  under the slots row. `npm test` (203) and `npm run build` both pass (no
  `shared/engine/` change, no golden regen — this round never touches the
  server or the pure rules layer). ✅ Done.
- ✅ **Small-screen layout pass ✅ CODE COMPLETE (2026-07-11):** a pure
  CSS/media-query pass, no JS or `index.html` changes — desktop stays
  pixel-identical, everything new lives behind `@media (max-width:560px)`
  (compact sizing) or `@media (pointer:coarse)` (tap-target bumps). A new
  block at the end of `styles/board.css` shrinks the unit card for phones
  (225px→164px, portrait/status-icon/plate/name-tier/stat/hp-bar
  dimensions scaled down with it, plus tighter `.field-frame`/`.battlefield`/
  `.army` padding/gaps) without touching the card's structure or content.
  `base.css` gets a matching `body` padding reduction at the same
  breakpoint, plus a `@media (pointer:coarse){.btn{min-height:38px}}`
  guard so every button — including the smaller nested variants
  (menu-drop items, the many `*-small` buttons) — clears a comfortable
  finger target on touch while mice see no change. `team.css`'s
  `.team-slot` and `farm.css`'s `.farm-slot` both shrink to a 172px basis
  at the same breakpoint to fit the smaller mobile card (two slots per row
  instead of one), and `team.css`'s ✕ clear button grows to 26px under
  `pointer:coarse`. `menu.css`'s `.menu-drop` gains
  `max-width:calc(100vw - 20px)` so a right-edge menu group's dropdown can
  never push off-screen. A sweep of the remaining panels
  (`admin.css`/`market.css`/`tournament.css`/`guild.css`/`adventure.css`)
  found no fixed width past what flex-wrap already handles — the one
  grid-based "table" in the app, the Arena ladder (`pvp.css`'s
  `.pvp-table`), got a defensive `overflow-x:auto` regardless. `npm test`
  (203) and `npm run build` both pass. ✅ Done.

**Done when:** a touch-screen finger can swipe-scroll a card row without a
drag capturing it, a deliberate ~300ms hold still lifts a card into a
proper drag on every drag surface (battlefield swap, Setup Team/Adventure
party picker, Setup Monster's — click-only, unaffected — picker, and the
Farm roster), mouse dragging feels exactly as it did before, touch users
see a hint explaining the hold, AND the layout itself reads well at phone
width. Round 1 (the interaction model) and round 2 (small-screen layout,
media-query only, desktop pixel-identical) are both done. **Phase 10.15 is
done.**

## Phase 10.16 — playtest fixes: picker scroll, Setup Monster detail, one-line slot rows

Staged 2026-07-11, one client-only round, three fixes:

- Every card row that rebuilds via `innerHTML = ""` on re-render now
  preserves its horizontal scroll position across that rebuild —
  `ui/monsterSetup.js`'s `.ms-cards` picker, `ui/partyPicker.js`'s
  `.team-roster`, and `ui/farm.js`'s `.farm-roster` each capture
  `scrollLeft` before clearing and restore it onto the freshly-built row, so
  clicking a card / staging a change / switching a bag tab / Save / Send /
  Cancel no longer snaps a scrolled-through row back to the start.
- The Setup Monster panel's detail header (`headerRow()`) is rebuilt to the
  current unit-card design language instead of its old pre-10.9 raw-emoji/
  plain-text style: a class-icon tile via a newly-EXPORTED
  `ui/board.js#classIconEl()`, the name with a colored element label
  (reusing board.css's global `.unit-element.element-*` classes so colors
  can never drift from the battlefield cards), a rank badge + `powerScore()`
  when the monster has a rank (the same `.unit-rank-badge`/`.unit-rank-power`
  classes and rank->color mapping `unitCardEl()` uses, mirrored onto
  `.ms-head` itself via a `.rank-<tier>` modifier class), the existing attrs
  line, and a new compact derived-stats badge row (HP/ATK/MATK/SPD/CRIT/EVA/
  ACC) — all read off the SAME gear-effective `laneView(m)` the picker cards
  already use, so it reflects staged changes too. `.ms-head-emoji` is
  retired (no remaining users).
- `.team-slots` (`styles/team.css`, shared by Setup Team and Adventure's
  party picker) and `.farm-slots` (`styles/farm.css`) both switch from
  `flex-wrap:wrap` to a single horizontal `overflow-x:auto` line, so the 3
  (or 2+1) slots never stack vertically on a phone and push the roster row
  out of view — the player was dragging blind. The `@media (max-width:
  560px)` slot sizing changes from a flex-basis to `flex:0 0 auto` so the
  ROW scrolls instead of the slots shrinking/stacking; the empty-slot label
  text gets a smaller font at that breakpoint too. Desktop is pixel-
  identical either way: 3 slots x 245px + 2x10px gaps = 755px sits
  comfortably inside the ~950px panel content width, so the row was already
  a single line before `nowrap` — it just now can't wrap even if a future
  change narrowed the panel.

`npm test` (203) and `npm run build` both pass — client-only, no
`shared/engine/`/`server/`/`db/` change. **Phase 10.16 is done.**

**Follow-up (2026-07-11, playtest):** the class-icon header treatment this
phase gave the Setup Monster panel didn't reach every place a monster's
species emoji still led a detail/picker row. The shared party picker's
click-for-detail area (`ui/partyPicker.js`, hosted by both Setup Team and
Adventure) now opens with the same class-icon tile instead of the emoji,
and the tournament register flow's and GVG team-submit flow's picker rows
(`ui/tournament.js`, `ui/guild.js`) got the identical treatment — emoji
retired from all three spots (plain-string bracket/lineup entrant labels
elsewhere in those two files, and Adventure's party/enemy chips, are
untouched — they carry no `cls` to look an icon up from).

## Phase 10.17 — goods icons (items, equipment, runes)

Staged 2026-07-11 from playtest feedback: every item/equipment/rune name in
the UI sits behind a blank text row today — no art in front of it at all,
unlike classes (10.12) and skills (10.13), which both already got a
DB-mapped icon column an admin can repoint live. Two rounds, same shape as
10.12/10.13's own split:

- **Round 1 (server + data):** an `icon` column on all three goods master
  tables (`item_defs`/`equipment_defs`/`rune_defs`, migration
  `023_goods_icon.sql`) — nullable, NULL means "derive from the def id"
  (e.g. `it_potion_small` -> `it_potion_small.png`), then `default.png`.
  `validateItem`/`validateEquipment`/`validateRune`
  (`server/services/adminValidate.js`) gained the exact `icon` grammar the
  class/skill validators already use; the column rides every existing read
  that already joins the def — the admin console's master list
  (`server/repos/admin.js`), `GET /api/trainer/inventory`
  (`server/repos/inventory.js`), and the marketplace's per-kind listing
  enrichment (`server/repos/market.js`) — plus `db/seed.mjs`'s upserts, with
  no value ever set on a shipped `src/data/*.js` row (that stays art-only,
  round 2's job).
- **Round 2 (client + art):** a new `ui/goodsMedia.js` renderer seam — the
  `ui/skillMedia.js` precedent — exporting one `goodIconEl(dir, good, size)`
  building an `<img>` off the lookup chain `good.icon || good.defId ||
  (good's own string id) || "default"` (a numeric INSTANCE id, present on
  owned equipment/runes alongside their string `defId`, is explicitly never
  allowed to leak into the URL), with the standard onerror-to-`default.png`
  loop-guarded fallback. Three new art folders, `public/icons/items/`,
  `public/icons/equipment/`, `public/icons/runes/`, each with a
  `default.svg`/`default.png` (a pouch / a sword / a faceted gem,
  respectively) and a README mirroring `public/icons/classes/README.md`'s
  lookup-order writeup. Every caller that already renders a good's name grew
  the matching icon ahead of it: the 🎒 Inventory panel's three tabs, the 🐾
  Setup Monster panel's equipped/bag rows, the 🏪 Marketplace's listing
  cards (item/equipment/rune kinds; monster listings unchanged), and the
  admin console's 🧰 Items/⚔ Equipment/🔮 Runes tabs — both their list rows
  and their forms, which each grew an "Icon id" field with a live preview
  (the classForm/skillForm `paintPreview` pattern, repainting on both the
  icon and id inputs since a new def's fallback depends on the id being
  typed).

`npm test` (206) and `npm run build` both pass — no `shared/engine/` change.
**Phase 10.17 is done.**

## Phase 11 — Chat, notifications & photo quest (later)

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
  filter, report/ban hooks into Phase 11's moderation basics), and
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
