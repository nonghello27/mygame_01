# CLAUDE.md — Battle Line → the Trainer game

Project context for AI coding agents (Claude Code, Antigravity, etc.) and
humans. Read this before making changes.

## 0. Orientation — read this first

This repo is a working prototype **growing into a bigger game**. Two layers:

- **What is BUILT today:** a tactical lane-battle prototype ("Battle Line",
  §2–§4 below). Two 3-unit columns; front units duel; the player's agency is
  arranging unit order before the fight. Server-authoritative resolution,
  client replays an event log.
- **What we are BUILDING toward:** a web game where the player is a
  **Trainer** who owns, trains, and equips **monsters**, sends them to work /
  training / adventures, and battles other players' formations (PVP,
  tournaments, GVG), with summons, runes, equipment, and a marketplace.

The vision and plans live in `docs/` — treat them as part of this file:

- **[docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)** — the game: trainer, monsters,
  skills, runes, activities, and the **reference battle-flow design** (§7).
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — target directory layout,
  data model (master/instance tables), battle **engine v2** spec, API surface.
- **[docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md)** — **how AI sessions
  must run implementation work here**: the main session is planner/PM only
  (read-only exploration, specs, review); every file edit is delegated to
  the `implementer` subagent and reviewed round by round. Read it before
  starting any implementation task.
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — phased build order. **When asked
  "what next?", answer from here.** Current position: Phases 0–6 complete
  (Firebase auth; owned monsters; tamper-proof matches; battle engine v2;
  work & training economy; admin console for master data; PVP ladder &
  trainer progression); Phase 7 (acquisition & itemization) is staged as
  sub-phases 7.1–7.4 in the roadmap — 7.1 (item schema & inventory), 7.2
  (equipment: equip, enhance, engine integration), 7.3 (runes: socket,
  consume, break, repair), and 7.4 (acquisition: Summon Hall + Adventure,
  both with a live panel now) are all code complete. Later phases were
  renumbered 2026-07-04: Phase 8 (marketplace + sell-to-system) is code
  complete; tournaments, guilds & GVG (Phase 9) are staged 2026-07-06 as
  sub-phases 9.1–9.7 in the roadmap (shared event rules → tournaments ×2 →
  guilds → GVG setup → engine carry-over → GVG resolution) — 9.1 (bracket +
  reward math), 9.2 (tournament schema, admin lifecycle, registration, with
  a live 🏆 Tournament panel + admin tab), 9.3 (tournaments' lazy
  resolution, rewards, a bracket/standings detail view), 9.4 (guilds:
  creation, membership, roles, with a live 🏰 Guild panel), 9.5 (GVG
  events: schedule, team submission, lineup, with a live ⚔ Guild vs. Guild
  section in the 🏰 Guild panel + an admin ⚔ GVG tab), 9.6 (the one engine
  change — carry-over battle state between relay battles), and 9.7 (GVG war
  resolution/rewards/results, with a live bracket/standings detail view in
  the same ⚔ Guild vs. Guild section) are all code complete — **Phase 9 is
  done**. Phase 10 (trainer & battlefield QoL) was staged 2026-07-07 as
  sub-phases 10.1–10.3 in the roadmap — 10.1 (admin: set any trainer's
  gold), 10.2 (battlefield party picker: choose which 3 owned monsters
  fight, free & PVP, with a live party strip), and 10.3 (a grouped
  dropdown menu bar over the control buttons) are all code complete.
  Phase 10 was EXTENDED 2026-07-08 with sub-phases 10.4–10.6, staged next
  from playtest feedback: 10.4 (a keep-enemy option on match creation, used
  by Setup Team's save — this sub-phase's battlefield 🎲 New Enemy re-roll
  button was later removed, 10.11's follow-up, as redundant with New
  Opponent), 10.5 (a leftmost "Me &
  Team" menu group whose drag-and-drop 🪖 Setup Team panel replaces the
  old battlefield party strip), and 10.6 (a monster-centric 🐾 Setup
  Monster gear panel in that same menu group) are all code complete —
  **Phase 10 (extended) is done**. Two more sub-phases, 10.7–10.8, were
  staged 2026-07-08: 10.7 (one view at a time — a direct 🏟 Playground
  button replacing the Playground dropdown, its battle controls moved to a
  row under the battlefield, and every panel exclusive of the battlefield
  and each other, via a small new `src/ui/views.js` registry) and 10.8 (the
  Setup Team panel's text chips become battlefield-style unit cards, shared
  with the battlefield via `ui/board.js`'s new `unitCardEl()`, with a
  click-for-detail area) are both code complete — **Phase 10 (10.4–10.8) is
  done**. Phase 10.9 (monster rank, power & the redesigned unit card +
  Adventure picker parity), staged 2026-07-10, is also code complete: a
  closed RANK ladder + display-only `powerScore()` (server + shared +
  admin), the redesigned `unitCardEl()` (a tooltipped class-icon header, a
  centered name, a rank badge/power/border/glow when ranked, an HP row, and
  a 2x2 atk/spd/runes/gear stat grid), and — the third and final slice — the
  Adventure panel's party picker now hosts the exact same drag-and-drop
  widget the Setup Team panel does, via a new `src/ui/partyPicker.js`
  extracted out of `team.js` so both panels share one
  `createPartyPicker()` instance factory. Phase 10.10 (playtest feedback),
  staged 2026-07-10, has two sub-phases: the first — the 🐾 Setup Monster
  panel's text-chip picker becomes a horizontally scrollable row of the
  same shared `unitCardEl()` cards, and its equip/unequip/socket/unsocket
  actions are now STAGED locally (keyed by piece id) behind a Save/Discard
  footer bar instead of firing immediately — is code complete; the second —
  farm slots (a server-enforced `MAX_FARM_SLOTS = 2` concurrent-job cap, a
  cancel-anytime-for-no-reward endpoint, and a slot-based 🏕 Farm panel
  redesign — a slots row of occupied/free/locked boxes over a drag-and-drop
  roster row of the same shared unit cards) — is ALSO now code complete —
  **Phase 10.10 is done**. Phase 10.11 (playtest feedback), staged
  2026-07-10, is also code complete: a compact header (the descriptive
  subtitle line under the title removed, its vertical footprint roughly
  halved) and a one-line menubar (tighter gap/font/padding on its
  top-level items only), plus the battlefield's two army rows now stack
  ("My Units" over "Enemy Units" with the VS clash zone between) at every
  width instead of the old side-by-side desktop layout, with both armies'
  front-line units rendered rightmost so lane 1 stays aligned across the
  stack — **Phase 10.11 is done**. Phase 10.12 (graphics), staged
  2026-07-10, is also code complete: class icons are now PNG-first (an
  explicit `icon` filename map on `CLASS_META`, art under
  `public/icons/classes/`) and battle now shows a per-unit status-icon row
  along the top of the portrait, filling left→right in the order gained,
  fed by the replayer's `status`/`status_end` events, with filenames mapped
  in `src/data/statusIcons.js` and art under `public/icons/statuses/` —
  **Phase 10.12 is done**, EXTENDED same-day with a playtest follow-up: a
  uniform 12px menu font, 28px status icons, the class→icon map promoted
  from `CLASS_META` to a live, admin-editable `classes.icon` column
  (migration `020_class_icon.sql`, with an image preview), and a read-only
  💫 Statuses reference tab in the admin console. Phase 10.13 (skill media),
  staged 2026-07-11, is also code complete: `skills.icon`/`skills.animation`
  columns (migration `021_skill_media.sql`) ride every monster read into a
  new `ui/skillMedia.js` renderer seam (an icon lookup chain plus an
  extension-picks-the-renderer animation chain), surfaced in the
  party-picker detail, the battle log, and the admin ⚔ Skills tab's two new
  fields with live previews. Phase 10.14 (playtest feedback), staged
  2026-07-11, is also code complete: an Adventure battle option now STAGES
  the fight instead of auto-resolving it — a new `pending_battle` column
  (migration `022_adventure_pending_battle.sql`) plus
  `/api/adventure/battle`/`/api/adventure/surrender` — and hands off to the
  REAL battlefield for an interactive two-phase fight with Surrender/
  Continue battle controls; every chest/gather/battle reward is escrowed in
  the run's loot log and granted in one place, only once the run actually
  completes, so a later loss can no longer keep loot a run never finished
  earning; a terminal run's summary now reads "What you brought home" (or
  a forfeit line) with an "End Adventure" button. The shared party picker's
  pool row (Setup Team, Adventure) now hides any monster already placed in
  a lane, so what's left below the slots is always exactly what's still
  available to pick.
  **Phase 10.14 is done.** Phase 10.15 (mobile & touch friendliness),
  staged 2026-07-11 from phone playtest feedback, is also code complete in
  two rounds: a shared `ui/pointerDrag.js` hold-to-drag/swipe-to-scroll
  engine — mouse unchanged, touch/pen now drags only after a ~300ms
  press-and-hold — behind every drag surface (battlefield swap, party
  picker, Farm roster), plus a ≤560px compact-layout & `pointer:coarse`
  tap-target CSS pass (smaller cards/slots/paddings, bigger buttons,
  desktop pixel-identical). **Phase 10.15 is done.** Phase 10.16 (playtest
  fixes), staged 2026-07-11, is also code complete: every rebuilt card row
  now preserves its scroll position across a re-render; the Setup Monster
  panel's detail header was rebuilt to the unit-card design language — a
  class icon, a colored element name, a rank badge/power, and a derived-
  stats line, all gear-effective; and `.team-slots`/`.farm-slots` became
  single-line horizontal scroll rows instead of wrapping, so the slots
  never stack above the roster on a phone. **Phase 10.16 is done.** Phase 11
  (chat, notifications & the photo quest) is next.

Don't build ahead of the roadmap phase you're in, and don't assume a
directory from ARCHITECTURE's *target* layout exists until it does — §3 below
is the layout that is real today.

## 1. Philosophy (non-negotiable, applies to all phases)

1. **Server-authoritative.** The client sends *choices* (orders, formations,
   job ids) — never stats, damage, rewards, or outcomes. Every handler
   validates choices against DB state (`applyOrder()` in
   `server/services/matches.js`, reached via `server/routes/battle.js`, is
   the model). Any value a handler trusts from the request body is a bug.
2. **Pure engine + event-log replay.** Battle resolution is a pure function
   — no DOM, no I/O, no wall clock — returning an ordered event list the
   client animates. The replayer never does math. Today that pair is
   `shared/engine/resolve.js` (authoritative) + `src/core/battle.js` (replayer).
3. **Master/instance data.** Baseline content in master tables; player-owned
   things are instance rows referencing a master id. Balance lives in data.
4. **Content as rows, not branches.** New skills/statuses/jobs are data
   interpreted by a small closed set of engine operations. Adding a skill
   must not add an `if` to the engine.
5. **Lazy time.** Timed activities store `ends_at` and resolve on next read.
   No cron, no websockets, until a feature proves the need.
6. **Determinism.** All randomness flows through a seeded PRNG; the seed is
   stored with the match so any result can be replayed and audited.

## 2. Tech stack

- **Vanilla JavaScript, ES modules.** No framework — intentional; keep
  dependencies minimal and the codebase approachable.
- **Vite** for dev server + build; deploys as a static site + **8 Vercel
  serverless functions, grouped by domain** (`api/auth/`, `api/battle/`,
  `api/trainer/`, `api/activities.js`, `api/admin/`, `api/adventure/`,
  `api/market/`, `api/guild/` — Hobby plan caps deployments at 12 functions;
  each domain internally routes multiple endpoints via a table in
  `server/routers/`, so growth inside a domain never costs a new function;
  the Vite dev middleware calls the matching `server/routers/<domain>.js`
  directly).
- **Neon Postgres** via `@neondatabase/serverless` (connection in `server/db.js`).
- **CSS + inline SVG + PNG sprite sheets** for art; motion is CSS keyframes.

Node 18+ recommended.

```bash
npm install      # once
npm run dev      # local dev server at http://localhost:5173
npm run build    # production build to dist/
npm run preview  # preview the production build
npm test         # node --test: engine golden logs + RNG (no DB needed)
npm run db:migrate  # apply pending db/migrations/ (needs .env)
npm run db:seed     # migrate + load master data from src/data/
```

## 3. Layout as it exists TODAY

(Full target layout — including `server/` — is ARCHITECTURE §3; grow into it
per roadmap phase, don't big-bang rename.)

```
├── index.html              # static shell + DOM the app mounts into
├── vite.config.js          # base:'./'; routes /api/<domain>/* to server/routers/<domain>.js in dev
├── api/                    # 8 serverless functions (Vercel Hobby caps at 12), one per domain:
│   ├── auth/[...route].js      # /api/auth/*      -> server/routers/auth.js
│   ├── battle/[...route].js    # /api/battle/*     -> server/routers/battle.js
│   ├── trainer/[...route].js   # /api/trainer/*    -> server/routers/trainer.js
│   ├── activities.js           # /api/activities   -> server/routers/activities.js (plain file: one
│   │                              # route, GET/POST/DELETE — cancel rides DELETE on the bare path)
│   ├── admin/[...route].js     # /api/admin/*      -> server/routers/admin.js
│   ├── adventure/[...route].js # /api/adventure/*  -> server/routers/adventure.js
│   ├── market/[...route].js    # /api/market/*     -> server/routers/market.js
│   └── guild/[...route].js     # /api/guild/*      -> server/routers/guild.js
├── server/                 # server-only logic (imported by api/, never by src/)
│   ├── routers/            # one file per domain: createRouter({...}) table (pathname→
│   │                       # {METHOD:handler}) + export route(); auth, battle, trainer,
│   │                       # activities, admin, adventure, market, guild — matches the
│   │                       # api/ entries 1:1
│   ├── routes/             # one handler per endpoint (happy path + httpError throws):
│   │                       # auth.js (login/logout), me, classes, activities, match,
│   │                       # battle, progression, trainerSkills, formation, ladder,
│   │                       # inventory (+ its sell), equipment.js (equip, enhance),
│   │                       # runes.js (socket, repair), summon.js (summonHall, summon),
│   │                       # adventure.js (state, start, move, abandon), market.js
│   │                       # (browse, mine, list, buy, cancel), tournament.js
│   │                       # (tournaments list, register, withdraw, detail — rides the
│   │                       # battle domain), admin.js (master + classes/skills/species/jobs/
│   │                       # items/equipment/runes/summons/adventures CRUD + grant +
│   │                       # trainers list/gold-set/monsters read+mint/attach/detach/
│   │                       # rank-set + tournaments create/cancel/list, Phase 9.5's
│   │                       # gvg/gvgCancel),
│   │                       # guild.js (browse, me, create, apply, accept, reject, leave,
│   │                       # kick, promote, transfer), gvg.js (Phase 9.5: events, submit,
│   │                       # withdraw, lineup, register — rides the guild domain)
│   ├── db.js               # Neon connection (lazy, from DATABASE_URL)
│   ├── auth.js             # Firebase token verify + HMAC session + cookie helpers
│   ├── http.js             # httpError(status, msg) + sendJson()/readJson() + createRouter()
│   ├── repos/              # SQL: trainers, species, monsters, matches, activities, admin,
│   │                       # progression (expertises/trainer_skill_defs/trainer_skills),
│   │                       # pvp (formations, seasons, rank_entries, matchmaking),
│   │                       # inventory (items/equipment/runes: grant + atomic consume,
│   │                       # plus sell-to-system's guarded consume/DELETE), equipment
│   │                       # (equip/unequip both domains, claim-first-then-pay enhance +
│   │                       # compensating revert/refund, equipped-gear reads), runes
│   │                       # (socket/unsocket guarded UPDATE, claim-first-then-pay
│   │                       # repair + revert, listSocketedRunes/applyRuneWear for battle
│   │                       # snapshots + post-battle durability), summons.js (enabled-
│   │                       # banner list, one banner's full detail incl. enabled, audit
│   │                       # insertSummon), adventures.js (enabled-route list, one route's
│   │                       # full detail incl. enabled, one-active-session read, claim
│   │                       # advance/abandon, loot-log append, party busy-lock claim/
│   │                       # release), market.js (listing CRUD + guarded escrow/assign
│   │                       # per kind, browse/mine enrichment), tournaments.js (create,
│   │                       # list-with-counts, guarded cancel-status-flip, entry CRUD +
│   │                       # idempotent per-entry refund claim, guarded withdraw DELETE,
│   │                       # the tournament party busy-lock claim/release pair, Phase 9.3's
│   │                       # settlement claims: bulk registration-window open, due-tournament
│   │                       # probe, guarded running/completed status flips, exactly-once
│   │                       # tournament_matches insert + read, idempotent per-entry reward
│   │                       # claim, entrant list for the detail view), guilds.js (guild CRUD +
│   │                       # member-count/browse read, getMembership (the one re-read every
│   │                       # write starts from), guarded leave/kick DELETEs and promote
│   │                       # UPDATE all excluding role='leader', claimTransferLeadership's
│   │                       # 3-statement leader-swap sequence, application insert/accept/
│   │                       # reject/list-by-guild/list-by-trainer)
│   └── services/           # matches.js (applyOrder gate + PVP Elo on resolve, gathers
│                           # equipped monster gear + socketed runes into toLane()'s
│                           # snapshot, settles rune durability from the engine's runeUse
│                           # tally after the resolve claim wins), activities.js
│                           # (lazy settle), admin.js (gate + CRUD + grant) +
│                           # adminValidate.js (pure grammar), progression.js (expertise/
│                           # learn-slot use-cases), pvp.js (defense formation, lazy season
│                           # rollover, matchmaking), inventory.js (grant/consume as atomic
│                           # claim-style statements for items/equipment/runes, plus
│                           # sellToSystem's claim-first-then-pay consume/DELETE + credit
│                           # with compensating restore), equipment.js (equip/unequip
│                           # use-cases + enhance's claim-first-then-pay flow), runes.js
│                           # (socket/unsocket + repair use-cases, same shape), summon.js
│                           # (performSummon: pluggable REQUIREMENT_CHECKERS pay/refund per
│                           # cost leg, seeded rollSummon() + mint + audit insert,
│                           # compensating refund/unmint on failure), adventure.js
│                           # (getState/start/move/abandon: lazy session expiry, party
│                           # busy-claim with compensating release, closed NODE_RESOLVERS
│                           # registry dispatching chest/gather/battle — battle calls
│                           # resolveBattle() directly, no matches row), market.js
│                           # (list/buy/cancel claim-first-then-pay with LIFO
│                           # compensations after a won claim), tournament.js (list/
│                           # register/withdraw claim-first-then-pay with LIFO
│                           # compensations, same performSummon shape; adminCreate/
│                           # adminCancel (factored into a shared cancelCore())/adminList;
│                           # Phase 9.3's settleTournaments() — the lazy on-read settlement
│                           # engine driving scheduled->registration->running->completed,
│                           # one bracket round resolved per pass via replayBracket() +
│                           # resolveBattle() called directly, a pluggable REWARD_GRANTERS
│                           # payout registry, and getTournamentDetail() for the bracket/
│                           # standings read), guild.js (create's claim-first-then-pay +
│                           # LIFO compensation over the flat gold cost, apply/accept/reject,
│                           # leave/kick/promote/transfer — every one re-deriving the caller's
│                           # role from getMembership() first, never trusting the body — and
│                           # me()'s guildless/member/leader-or-officer three-shape view),
│                           # eventRewards.js (the REWARD_GRANTERS registry lifted out of
│                           # tournament.js the moment GVG needed the identical payout
│                           # registry too — one source of truth, no drift), gvg.js (Phase
│                           # 9.5's team submission/withdrawal/lineup/registration plus
│                           # Phase 9.7's settleGvg()/settleRunningGvg() war-resolution
│                           # engine — one guild-vs-guild war per bracket pairing via
│                           # shared/rules/gvgWar.js's resolveWarRelay(), an exactly-once
│                           # insertGvgWar() claim, immediate lock release on a guild's
│                           # elimination rather than waiting for the event's end, the
│                           # shared REWARD_GRANTERS payout, and getGvgDetail() for the
│                           # bracket/standings read)
├── db/
│   ├── migrations/         # NNN_name.sql, applied in order (append-only once live;
│   │                       # up to 021_skill_media.sql)
│   ├── migrate.mjs         # npm run db:migrate (tracked in schema_migrations)
│   └── seed.mjs            # npm run db:seed (migrates, then loads master data)
├── shared/                 # PURE game logic imported by BOTH api/ and src/
│   ├── engine/
│   │   ├── resolve.js      # engine v2: readiness loop + turn pipeline; source of truth
│   │   └── rng.js          # seeded PRNG (mulberry32); ALL outcome randomness
│   └── rules/              # balance data: formulas, elements, targeting, statuses,
│                           # progression (expertise unlock exp, learn-slot validation),
│                           # pvp (Elo delta, season-end reward tiers), summon.js
│                           # (rollSummon: pure seeded weighted roll over a pool),
│                           # adventure.js (generateMap/deriveNodeSeed/rollLoot/rollEncounter:
│                           # pure seeded map generation + node rolls), bracket.js
│                           # (generateBracket/nextRound/placements: seeded single-
│                           # elimination bracket + rank math, Phase 9.1; derivePairingSeed/
│                           # replayBracket: Phase 9.3's per-pairing seed derivation + the
│                           # read-side "rebuild the bracket from a durable results log"
│                           # rebuild — no bracket is ever persisted as JSON), rewards.js
│                           # (the tournament/GVG reward grammar + resolveRewards()
│                           # position/percentile payout math, Phase 9.1), gvgWar.js
│                           # (resolveWarRelay(): Phase 9.7's pure seeded guild-vs-guild
│                           # war — a chain of resolveBattle() calls over two ordered
│                           # lineups per the carry-over/elimination/tiebreak rules, a
│                           # small per-battle battles[] summary out, never the event log)
├── tests/                  # node --test; fixtures.mjs + golden/ (regen.mjs)
├── public/sprites/         # uNN.png sheets + TEMPLATE.md (art spec)
└── src/
    ├── main.js             # ENTRY: imports CSS, inits modules, wires buttons
    ├── config.js           # COLORS, accentFor(), cutscene timings
    ├── styles/             # base.css (tokens) | board | menu | cutscene | sprite | auth | farm
    │                       # | admin | pvp | trainer | inventory | summon | adventure | market
    │                       # | tournament | guild | team | monsterSetup
    ├── data/               # seed content: classes, sprites, units, skills, jobs, expertises,
    │                       # items, equipment, runes, summons, adventures
    ├── services/           # I/O boundary: content.js, auth.js, firebase.js, storage.js, admin.js
    ├── core/
    │   ├── units.js        # makeUnit(), cloneRoster()
    │   ├── state.js        # shared state + initContent()/resetState()
    │   └── battle.js       # client REPLAYER: requestBattle() + animate events
    ├── ui/                 # board (exports unitCardEl(), Phase 10.8's shared battlefield-
    │                       # style card builder, besides its own battle rendering — Phase
    │                       # 10.9 redesigned its plate: a header row (a class-icon tile with a
    │                       # native title tooltip, via the new classIconEl()/public/icons/
    │                       # classes/, an element-name label under it, a centered
    │                       # length-auto-fit name, and a rank-<tier> modifier class driving
    │                       # a rank-colored border/glow plus a rank badge + powerScore() number
    │                       # from shared/rules/formulas.js), an HP row, and a 2x2 stat-tile
    │                       # grid (atk range/spd/socketed-rune count/equipped-gear count) —
    │                       # client-display-only, never sent anywhere; refined 2026-07-10 after
    │                       # playtest: a wider 225px card, a smaller class-icon tile mirroring
    │                       # the rank badge column, and the name never truncates — it shrinks
    │                       # through size tiers by length instead; Phase 10.11 stacked the two
    │                       # army rows — renderBoard() renders BOTH armies back-to-front so each
    │                       # front-line unit sits rightmost, keeping lane 1 aligned across the
    │                       # "My Units"/"Enemy Units" stack; Phase 10.12 added a status-icon row
    │                       # atop the portrait, rendered by unitCardEl() and kept live by the
    │                       # replayer's status/status_end events via the new updateCardStatuses()
    │                       # export, filenames mapped in data/statusIcons.js); Phase 10.16 also
    │                       # exported the module-local classIconEl() so ui/monsterSetup.js's
    │                       # detail header can build the same class-icon tile), sprite,
    │                       # skillMedia (Phase 10.13: skill icon lookup — icon||slot||"default" —
    │                       # plus an extension-picks-the-renderer skill animation renderer,
    │                       # surfaced in the party-picker detail and the battle log),
    │                       # pointerDrag (Phase 10.15: the shared hold-to-drag/swipe-to-scroll
    │                       # pointer engine — beginPointerDrag({sourceEl, findTarget, onDrop,
    │                       # cloneClasses}) — behind dragdrop/partyPicker/farm; mouse drags on a
    │                       # small movement threshold, touch/pen drags only after a ~300ms
    │                       # press-and-hold so a swipe still scrolls the row/page),
    │                       # dragdrop (the battlefield's swap-lanes drag, now riding
    │                       # pointerDrag.js), log, chroma, auth, farm, admin,
    │                       # pvp (Arena panel: ladder + defense editor), trainer (expertise +
    │                       # skills), inventory (🎒 panel: Items | Equipment | Runes),
    │                       # summon (✨ Summon Hall panel: banner cards + pull), adventure
    │                       # (🗺 panel: route list + a Phase 10.9 partyPicker.js party picker
    │                       # (the same card-based drag-and-drop widget Setup Team hosts),
    │                       # step options, run log; Phase 10.14's client slice — a staged
    │                       # battle option renders a "To battle" notice + enemy chips (also
    │                       # the resume-after-refresh state, since pendingBattle rides every
    │                       # session read) that hands off through an injected enterBattle hook
    │                       # to main.js's real battlefield instead of resolving inline, and a
    │                       # terminal run's summary gained a "what you brought home" tally vs.
    │                       # a forfeited hint, its button now "End Adventure"),
    │                       # marketplace (🏪 panel: browse + my listings + list-a-good picker),
    │                       # tournament (🏆 panel: open/upcoming cards with a register flow +
    │                       # party picker, my-entry + withdraw, a past-tournaments history list,
    │                       # and (Phase 9.3) a per-tournament "Details" bracket/standings view),
    │                       # guild (🏰 panel: guildless browse/apply/create, member roster +
    │                       # Leave, leader/officer read of the pending-application queue,
    │                       # leader-only accept/reject/kick/promote/transfer controls, and
    │                       # (Phase 9.5) a ⚔ Guild vs. Guild section — open-event cards with
    │                       # a team-submit party picker for any member, plus a leader-only
    │                       # per-team lineup-order editor and register-guild button, and
    │                       # (Phase 9.7) a per-event "Details" war-bracket/standings view
    │                       # off the same section, mirroring the tournament panel's own),
    │                       # partyPicker (Phase 10.9: the shared 3-lane drag-and-drop party
    │                       # picker EXTRACTED out of the Setup Team panel — a
    │                       # createPartyPicker({monsters, initialSlots, onChange}) factory
    │                       # returning {el, getSlots, setSlots, setMonsters} so team.js and
    │                       # adventure.js can each host an independent instance; the slots
    │                       # row, sort bar (order/name/power, asc/desc), horizontally
    │                       # scrollable owned-monster row, click-for-detail area, and
    │                       # pointerDrag.js-driven drag-and-drop (Phase 10.15: hold-to-drag on
    │                       # touch) are all still styled by styles/team.css's team-*/
    │                       # party-picker classes, global; both lane slots and roster
    │                       # cards render via board.js's shared unitCardEl() over a
    │                       # display-only deriveStats(m.base, m.attrs) lane — full HP, never
    │                       # sent anywhere — and clicking any card opens the click-for-detail
    │                       # area, stats/attrs/skills/busy state plus "Set lane 1/2/3"/
    │                       # "Remove from team" actions, the no-drag placement path
    │                       # tap-to-place used to be; the roster row hides any monster
    │                       # already placed in a lane, Phase 10.14 — it shows only the
    │                       # remaining pool),
    │                       # team (🪖 Setup Team panel, Phase 10.5: a "Me & Team" menu-group
    │                       # panel — now just a HOST (Phase 10.9) over partyPicker.js's
    │                       # widget, built fresh from a loadFarm() roster read on every
    │                       # refresh(); Save fields the party against the SAME enemy via
    │                       # keepEnemyMatchId, and the module still owns the remembered
    │                       # party ids for every openMatch() caller),
    │                       # monsterSetup (🐾 Setup Monster panel, Phase 10.6: pick one owned
    │                       # monster — Phase 10.10's picker is a horizontally scrollable row of
    │                       # the shared unitCardEl() cards, click to select — and stage
    │                       # equip/unequip/socket/unsocket changes against its gear/runes
    │                       # (a Map<pieceId, targetMonsterId|null> per domain, keyed by piece
    │                       # so switching the selected monster never discards a pending change);
    │                       # a Save/Discard footer bar applies every staged change SEQUENTIALLY
    │                       # over the existing equip/socket endpoints, unequips/unsockets first
    │                       # to free slots/capacity before the equips/sockets that follow, stops
    │                       # and surfaces the server's message on the first failed call while
    │                       # leaving the rest staged for retry, and clears both maps only once
    │                       # every op lands; Phase 10.16 rebuilt the detail header to the
    │                       # unit-card design language — board.js's classIconEl(), a colored
    │                       # element label, a rank badge/power, and a derived-stats badge row,
    │                       # all off the same gear-effective laneView(m) — and made the picker
    │                       # row's scroll position survive a re-render),
    │                       # menubar (Phase 10.3: a grouped dropdown menu bar over the existing
    │                       # button ids — Me & Team (Phase 10.5's leftmost group, holding
    │                       # Setup Team, Setup Monster (10.6), and the relocated Inventory
    │                       # button)/Activities/Battlefield dropdowns plus a few direct
    │                       # top-level buttons; Playground is now (Phase 10.7) a direct
    │                       # 🏟 Playground button — its four battle controls live in a
    │                       # #battleControls row under the battlefield, inside
    │                       # #playgroundView),
    │                       # views (Phase 10.7: the one-view-at-a-time registry —
    │                       # registerView(name,{button,el,onShow})/showView(name); every
    │                       # panel module registers itself here instead of wiring its own
    │                       # show/hide toggle, so entering any view hides every other one)
    ├── cutscene/           # cutscene.js, portraits.js (SVG), effects.js
    └── utils/helpers.js
```

### Current data model & combat flow

Master/instance in action: `monster_species` + `species_skills` (master,
seeded from `src/data/units.js` + `skills.js`; `starter` species are granted
to new trainers on their first match) → `monsters` + `monster_skills`
(instance rows owned by a trainer; attributes and skill levels grow
per-instance). A battle lane = identity (`idx`, monsterId, speciesId) +
traits (element, attackKind, attackStyle, targeting) + DERIVED stats (maxHp,
atkMin/Max, matkMin/Max, spd, crit, evade, acc — computed once by
`deriveStats()` in the match snapshot) + `skills[]` with their JSONB data.
The stable `idx` is the only identity the client and server exchange. Two linking keys: **`cls`** → attack name/fx
(`data/classes.js` → cutscene), **`sprite`** → sheet in `data/sprites.js`
(falls back to `emoji`). Nothing in `core/`/`ui/` calls the API directly —
always via `services/content.js`.

Flow: login → `POST /api/battle/match` (server assembles YOUR team from
`monsters` — the first 3 available, or the exact 3 the optional
`monsterIds` picks, in that order (Phase 10.2) — picks + freezes the enemy
team/order (or, given an optional `keepEnemyMatchId` naming the caller's
own prior free match, re-freezes THAT match's enemy verbatim instead —
"same enemy, new lineup", Phase 10.4), mints + stores the seed in
`matches`) → drag your lanes only → `POST /api/battle/resolve {matchId,
playerOrder}` (permutation
gate `applyOrder()` in `server/services/matches.js`; each match resolves
exactly once — replays get 409) → server runs `resolveBattle(A, B, seed)`
from the snapshots and persists the result → client replays the event log
(`turn`/`skill`/`strike`/`miss`/`dot`/`status`/`heal`/`buff`/`skip`/`fall`/
`draw`) — cutscenes, HP bars, lane shifts; the replayer never does math.

Engine v2 (`shared/engine/resolve.js`): readiness gauges fill by effective
SPD (threshold subtract, overflow carries) → per turn: status ticks →
control check → ultimate-if-ready else normal else basic attack → targeting
registry → damage. ALL rolls go through the seeded rng; same snapshot + seed
⇒ same log. Damage has ONE choke point: `strike()`. Skills/statuses are
JSONB rows interpreted by the closed op set (`shared/rules/`); adding content
must not add engine branches. Combat rules change ⇒ change the engine/rules
(golden tests will diff — regenerate via `node tests/golden/regen.mjs` in the
same commit) and usually add an event field for the replayer; never compute
outcomes client-side.

Economy (Phase 4): `job_defs` (master, seeded from `src/data/jobs.js`) →
`activities` (instance; `ends_at` + persisted `outcome`). Lazy time in
practice: `settleActivities()` (`server/services/activities.js`) runs on
every authenticated read (`/api/trainer/me`, `/api/activities`, match creation) and
pays out finished jobs — work → trainer gold/exp, training → +1 monster
attribute — each in ONE atomic claim+pay statement, exactly once. Busy lock:
`monsters.busy_until`/`busy_kind`, taken atomically at job start; busy
monsters are excluded from new matches and can't take a second job.
"Collect" is still just a re-read — settlement happens lazily on any
authenticated read, the farm panel never computes a payout — but the farm
panel (`src/ui/farm.js`) is no longer *pure* display: Send and Cancel are
real player choices posted straight to the server, the client only ever
proposes them. Phase 10.10 (server slice): the farm is capped at
`MAX_FARM_SLOTS = 2` concurrent unresolved jobs, enforced inside the
activity INSERT itself (never a precheck-then-act pair) so two racing
starts can't both squeeze into the last slot; and a job is cancellable
anytime for no reward via `DELETE /api/activities {activityId}`, which
rides the existing bare route as a new METHOD rather than a new sub-path.
Phase 10.10 (client slice): the 🏕 Farm panel is a slot-based layout — a
slots row (one box per the server-reported `farmSlots`, plus one purely
decorative locked box) rendered above a horizontally scrollable roster row
of shared battlefield-style unit cards (board.js's `unitCardEl()`, the
`ui/partyPicker.js`/`ui/monsterSetup.js` precedent). An occupied slot shows
the working monster's card, its job, the countdown, and a Cancel button
(confirm-gated, no reward); a free slot is a drop target you can stage a
monster + job into (drag-and-drop, adapted from `partyPicker.js`'s pointer-
drag pattern, or a no-drag click-to-place fallback into the first empty
slot) and then Send. Staged picks are session-local state, reconciled
against the roster on every server read.

Admin console (Phase 5): accounts whose email is in the `ADMIN_EMAILS` env
var get `trainers.is_admin` at login (promotion only; demote by SQL). The
⚙ Admin button (admins only, `src/ui/admin.js`) opens tabs over the four
master tables + a sprite gallery; `/api/admin/master` returns them plus the
enum registries from `shared/rules/` so dropdowns can't drift from the
engine. Writes are validated server-side (`server/services/adminValidate.js`
— pure, tested in `tests/admin-validate.test.mjs`); deletes 409 while
instance rows reference the master row. CAVEAT: `npm run db:seed` upserts
from `src/data/*.js` and overwrites admin edits to rows with the same ids —
once you edit live, the DB is the source of truth for those rows. A 👥
Trainers tab rounds out the console with a roster browser: it lists every
account, and "Manage" opens one trainer's monster roster with two ways to add
a monster (a species picker + "Mint monster" mints a fresh instance straight
from the species master row, same mint the Summon Hall uses; a picker over
every unassigned monster + "Attach" links one of those instead) and, per
monster, a "Remove" button that detaches it — the relation is removed but the
monster persists unassigned with its grown attributes/skills intact, and its
equipped gear/socketed runes return to the trainer's bag; the server refuses
the detach with 409 while the monster is busy or still sits in that trainer's
saved PVP defense formation (`GET /api/admin/trainers`, `GET/POST/DELETE
/api/admin/monsters`). The 🎭 Classes tab's form (Phase 10.12 follow-up)
carries an `icon` field with a live image preview, naming a base filename
under `public/icons/classes/` (empty = the class name lowercased) — the
classes master table's own column, served to the client via `GET
/api/trainer/classes` and consumed by `ui/board.js`'s `classIconEl()`. A
💫 Statuses tab is read-only reference only — statuses are the engine's
CLOSED registry (`shared/rules/statuses.js`) and are never DB rows, so the
tab just surfaces the id/label/icon-file mapping (`src/data/statusIcons.js`)
for an admin to check. The ⚔ Skills tab's form (Phase 10.13) carries the
same pattern one level down: `icon` (base filename under
`public/icons/skills/`, empty = the skill's slot placeholder, then
`default.png`) and `animation` (a filename under `public/anim/skills/`,
extension picks the renderer) fields, each with a live preview, via
`ui/skillMedia.js`.

PVP (Phase 6): `expertises` + `trainer_skill_defs` (master, seeded from
`src/data/expertises.js`) → `trainer_skills` (instance; 2 fixed learn slots,
switching expertise wipes both atomically). A trainer saves a 3-monster
`formations`/`formation_slots` row (`purpose='defense'`) as the team PVP
attackers fight while they're offline. `POST /api/battle/match {mode:"pvp"}`
matches the attacker's own available roster against another trainer's
complete defense formation drawn from a small pool ordered by rating
proximity (`listPvpCandidates`); both sides' derived-stat lanes AND
trainer-skill snapshots freeze into the `matches` row (`kind='pvp'`,
`defender_id`, `attacker_trainer`/`defender_trainer`) exactly like free
matches freeze the enemy team. `resolveBattle`'s 4th arg feeds those frozen
skills into the engine's `battle_start`/`after_ally_turns` triggers (`tskill`
events). Elo (`shared/rules/pvp.js`, K=32) is applied to both sides' ratings
exactly once, only after the resolve claim is won, so a replay can't
double-apply it. Seasons roll over lazily (`ensureSeason`, same
read-then-claim shape as `settleActivities`) on every PVP read/write —
closing an expired season pays out gold by rank tier and opens the next one.
The Arena panel (`src/ui/pvp.js`) is the ladder + defense editor; the
Trainer panel (`src/ui/trainer.js`) is expertise + skill-slot picking —
both pure display over their `/api/*` reads.

Itemization (Phase 7.1): `item_defs`/`equipment_defs`/`rune_defs` (master,
seeded from `src/data/items.js`/`equipment.js`/`runes.js`) → `items` (qty
stacks, `UNIQUE(trainer_id, def_id)`), `trainer_equipment`/`monster_equipment`,
`runes` (instance rows; a NULL `equipped_slot`/`monster_id` means "in the
bag"). Effects reuse the exact skill-passive `battle_start`/`perm_stat`
grammar (`validateBattleStartEffects` in `server/services/adminValidate.js`
is shared with skill passives, with an optional `perLevel` skills don't get —
7.2's enhancement system scales off it).
`monster_species.rune_slots` is added here for 7.3 to consume later.
Acquisition was admin-grant-only at this phase (`POST /api/admin/grant`) —
the Summon Hall (Phase 7.4) later added a player-facing path for monsters,
though items/equipment/runes still only reach a trainer via grant until
Adventure/the marketplace. `GET /api/trainer/inventory` is the one read
(items + equipment + runes in one call).

Equipment (Phase 7.2): `POST /api/trainer/equipment/equip {domain:'trainer'|
'monster', equipmentId, monsterId?, equip?}` equips/unequips one owned piece
— monster domain by `monsterId` (`null` unequips), trainer domain by an
`equip` boolean; equipping into an occupied slot auto-returns the previous
occupant to the bag in the same statement (`server/repos/equipment.js`).
`POST /api/trainer/equipment/enhance {domain, equipmentId}` raises
`enhance_level` by 1 via claim-first-then-pay (the enhance-level UPDATE's
WHERE is the whole gate; gold debit and an optional `material:{itemId,
qtyPerLevel}` spend follow, with a compensating revert/refund if either leg
loses to a race) — both endpoints return the refreshed inventory (enhance
also returns `gold`). Engine wiring: `toLane()` (`server/services/matches.js`)
folds a monster's *equipped* monster-domain gear into its frozen lane
snapshot as a battle_start effect source (free and PVP matches alike;
trainer-domain gear is PVP-only, same parity as trainer skills);
`resolveBattle`'s trainer arg widened from a bare skills array to
`{skills, equipment}`.
Firing order at `battle_start`: trainer skills → unit passives → monster
equipment → trainer equipment → runes (7.3). The 🎒 Inventory panel
(`src/ui/inventory.js`) is tabs Items | Equipment | Runes; the Equipment tab
now carries equip/unequip controls (a monster picker for monster-domain
pieces) and a cost-labeled Enhance button ("MAX" at the curve's cap),
re-rendering from whatever the acted-on endpoint hands back.

Runes (Phase 7.3): `POST /api/trainer/runes/socket {runeId, monsterId|null}`
sockets/unsockets one owned rune (a guarded UPDATE re-checks ownership,
`broken = false`, and the target monster's species `rune_slots` capacity
atomically — 409 "repair it first" / "no free rune slots"); `POST
/api/trainer/runes/repair {runeId}` fully recharges one owned rune via the
same claim-first-then-pay shape as equipment's enhance (409 "rune doesn't
need repair" when already full and unbroken). Both are grouped under the
`trainer` domain (no new serverless function) and return the refreshed
inventory (repair also returns `gold`). Grammar: a rune's `effects` are
EITHER the same `battle_start`/`perm_stat` shape equipment uses, OR a
rune-only trigger, `{when:"target_select", op:"override_targeting", rule}`,
that redirects a turn's target choice to a named `targeting.js` rule
(`rn_hunter` in `src/data/runes.js` seeds this case). Every trigger of
either kind costs exactly **one charge = one `rune` event**
(`{t:"rune", side, idx, rune:<defId>, name}`), however many `battle_start`
effects a def carries — the engine is pure and never writes charge state,
it only *reports* consumption via a `runeUse:{a,b}` tally (rune instance id
→ charges spent) on the result; `resolveMatch()`
(`server/services/matches.js`) spends that tally against the DB, by
instance id, only AFTER the resolve claim wins (same once-only guard Elo
rides), and **only against the attacking side** — a PVP defender's saved
formation is fought while they're offline and never pays durability for it.
Breaking (`charges_left` hits 0) and auto-unsocketing happen in the same
guarded UPDATE as the decrement. The replayer (`src/core/battle.js`) just
narrates each `rune` event as a log line — no math, same shape as its
`tskill`/`buff` handlers.

Summon Hall (Phase 7.4 step A): `summon_defs` (master, seeded from
`src/data/summons.js`; a banner's `cost` is a non-empty list of
`{type:'gold',amount}`/`{type:'item',itemId,qty}` requirement objects
dispatched through a pluggable `REQUIREMENT_CHECKERS` pay/refund registry in
`server/services/summon.js`, and its `pool` a non-empty weighted
`{speciesId, weight}` list; `enabled` is the retirement lever) →
`summons`, an audit-only instance table (one row per pull: trainer, banner,
**snapshots** of that banner's `cost`/`pool` at pull time so a later admin
edit can't retroactively change what an old pull says was charged/offered,
the RNG `seed`, and the resulting species/monster). Flow: `GET
/api/trainer/summon` lists enabled banners → `POST /api/trainer/summon
{summonId}` pays every cost leg claim-first-then-pay (a losing leg refunds
every already-paid leg, LIFO) → mints a fresh seed → `rollSummon()`
(`shared/rules/summon.js`, pure/seeded, same determinism contract as the
engine's own RNG) draws one species from the pool → mints the monster
(`mintMonster`, the same helper `grantStarters` uses) → writes the audit
row — with a compensating `unmintMonster()` **and** a full cost refund if
anything from the seed mint through the audit insert fails, so a pull can
never leave a trainer charged with nothing minted, or minted with nothing
charged. `summon_defs` gets the full Phase 5 admin workflow (validated CRUD,
guarded 409 delete, a `pullCount` usage badge) in this same step. The ✨
Summon Hall panel (`src/ui/summon.js`) is pure display over one banner list
plus one pull action, same panel shell as 🎒 Inventory (msgs + body,
refresh-on-open) — it shows each banner's human-readable cost line and, on a
successful pull, the minted monster's emoji/name/species and the trainer's
new gold balance.

Adventure (Phase 7.4 step B, session engine — SIXTH domain, `api/adventure/`):
`adventure_defs` (master, seeded from `src/data/adventures.js`; `config` is
the whole map/loot grammar `shared/rules/adventure.js` reads — `steps`,
`choices` per step, a weighted node-type table (`battle`/`chest`/`gather`),
the wild `encounters` pool, `loot`/`gather` tables, `catchPct`, and (Phase
10.14) an optional `enemies:{min,max}` knob, both 1-3, defaulting to
`{min:1,max:3}` — how many wild monsters a `battle` node fields) →
`adventure_sessions`, an instance row per run — **frozen** at start exactly
like `matches` freezes a battle's inputs: `seed`, `map` (`generateMap(config,
seed)`'s output), `party` (`{lanes, display}` — `lanes` mirrors `toLane()`'s
battle-snapshot shape, equipped gear/socketed runes included, in the
player's CHOSEN lane order), `position`, `state`
(`active → completed | failed | abandoned`), a running `loot` log, `ends_at`,
and (Phase 10.14) `pending_battle` — NULL unless a battle option's fight is
currently staged. At most one `active` session per trainer (partial unique
index, same precedent as "at most one active season"). Flow: `GET
/api/adventure/state` lazily expires an overdue session (`ends_at` past ⇒
`abandoned`, same read-then-claim shape as `ensureSeason`) and returns the
enabled routes (id/name/description ONLY — `config` is server balance data,
never shipped) plus the current session view, which exposes ONLY the step in
front of the player (`options`, forced `null` whenever a battle is staged)
plus, while one is staged, both sides' frozen lane snapshots under
`pendingBattle` (the same disclosure level `POST /api/battle/match`'s
`you`/`enemy` already sets) — never the whole frozen map, which would leak
upcoming nodes. `POST /api/adventure/start {adventureId, monsterIds}` claims
the 3-monster party's busy lock in one statement (`claimPartyForAdventure`,
same shape as `claimMonsterForJob`, `busy_kind = 'adventure'`) with a
compensating `releaseParty()` on any later failure (same spirit as Summon
Hall's unmint/refund), then mints the seed and freezes the map + party.
`POST /api/adventure/move {choice}` validates `choice` against the CURRENT
step only (409 "resolve the staged battle first" while one is already
pending) and dispatches by node type: `chest`/`gather` still claim the step
exactly once (`claimAdvance`, same claim-guard shape as `applyOrder`'s
resolve claim) and resolve DETERMINISTICALLY off
`deriveNodeSeed(session.seed, position)` through a closed `NODE_RESOLVERS`
registry in `server/services/adventure.js` — a new ONE-SHOT node kind is one
registry entry, never a branch in `move()` (`ADVENTURE_NODE_TYPES`, same
closed-set philosophy the engine uses for skills) — rolling `rollLoot()` and
only LOGGING the result (`{loot:[...]}`), never granting it mid-run. `battle`
is the one TWO-PHASE node kind (Phase 10.14): `move()` instead rolls a wild
team sized by `config.enemies` via `rollEncounter()` and freezes it into
`pending_battle` (`claimStageBattle`, the `claimAdvance` role minus
advancing `position` — a staged fight still occupies the current step);
`POST /api/adventure/battle {order}` then resolves it with the player's own
lane order (`applyOrder()`'s exact permutation gate) against the frozen
`nodeSeed`, calling `resolveBattle()` **directly** — **no `matches` row**,
since an adventure fight has no opposing trainer and only ever needs to
update this one session — claims the settlement exactly once
(`claimSettleBattle`), settles the party's rune durability exactly like
`resolveMatch` (win or lose, against the frozen snapshot's charges, the same
accepted wrinkle as two open matches sharing a snapshot), and on a win rolls
a `catchPct` chance to record (not yet mint) a defeated wild species. A
lost/drawn battle fails the run; the final step's win completes it; either
terminal state releases the party. `POST /api/adventure/surrender {}` is the
other way to resolve a staged battle — an unconditional defeat, no order
needed. Loot/catches are ESCROWED, not granted as they're logged: every
chest/gather/battle outcome only appends to `loot`; a new `grantRunRewards()`
walks that whole log and grants every item stack + mints every catch, but
ONLY once, from `battle()`, the moment a run's state flips to `'completed'`
— a defeat, a surrender, an abandon, or lazy expiry forfeits everything
logged so far. The battle event log never touches the session row
(re-derivable forever from the stored seed, CLAUDE.md §1.6) — it only ever
rides in the response's `node.battle.events`. `POST /api/adventure/abandon
{}` gives up early (guarded `active → abandoned`), releasing the party
(discarding any staged battle along with it). `adventure_defs` gets the admin CRUD half
of the Phase 5 workflow (`validateAdventure()`, guarded 409 delete, a
`sessionCount` usage badge, and a 🗺 Adventures tab in `src/ui/admin.js`
mirroring Summons' one-JSON-textarea-for-config approach). The 🗺 Adventure
panel (`src/ui/adventure.js`) is pure display + action over six endpoints
(`src/services/content.js`'s `fetchAdventureState()`/`startAdventure()`/
`moveAdventure()`/`resolveAdventureBattle()`/`surrenderAdventureBattle()`/
`abandonAdventure()`): no session shows a route list with a shared party
picker (borrowed straight from the Arena defense editor's row shape —
`loadFarm()`'s `busyUntil`/`busyKind` disable a busy monster) and a
per-route "Set out" button gated on exactly 3 picks; an active session
shows the step header, party chips, the run's loot log so far, and the
CURRENT step's options as Go-able cards — UNLESS a battle is staged
(`session.pendingBattle`), which the panel renders as a "To battle" notice
+ enemy chips instead (both on picking a fresh battle option and, since
`pendingBattle` rides every session read, on resuming one after a page
refresh); a terminal session (completed/failed/abandoned) is narrated from
the just-returned outcome and kept in module memory for a one-screen
summary (same precedent as `ui/summon.js`'s results map) — an aggregated
"what you brought home" tally on a completed run vs. a one-line "forfeited"
hint otherwise — until "End Adventure" is clicked. Battles no longer replay
inside this panel at all (Phase 10.14's client slice): "To battle" hands
`pendingBattle` off through an injected `enterBattle` hook (main.js's
`enterAdventureBattle()`, the `initPvp(startRankedBattle)` precedent — this
module never imports `main.js`), which loads it onto the REAL battlefield
via `core/state.js`'s `loadAdventureBattle()` (setting a
`state.adventureBattle:{position}` marker `core/battle.js`'s `runBattle()`
branches on, resolving through `resolveAdventureBattle()` instead of
`requestBattle()`, same replayed event log either way) and switches to the
Playground view, where a Surrender button (posts `surrenderAdventureBattle()`,
confirm-gated) stands in for Reset/New Opponent until the fight ends, then a
Continue button hands the fresh session back to `ui/adventure.js` via its
`noteAdventureBattleResult()` export and returns here.

Marketplace (Phase 8): `marketplace_listings` is an instance table
referencing another owned instance (an item stack, an equipment piece, a
rune, or a monster) rather than a master def — a listing escrows a real
good, it doesn't mint one. Listing removes the good from usable inventory
the moment it lists: items split `qty` off the stack (item stacks have no
instance row to detach); equipment/runes detach to `trainer_id = NULL`
(013 drops `NOT NULL` on `trainer_equipment`/`monster_equipment`/`runes`'
`trainer_id`, extending `012_monster_release.sql`'s "unassigned instance"
precedent for monsters to the other instance tables); monsters detach to
that same unassigned state, with every obligation (busy, in the defense
formation, still-equipped gear, still-socketed runes) folded into ONE
guarded UPDATE (`escrowMonster` in `server/repos/market.js`) rather than a
precheck-then-act race. `buy` is a claim (`open → sold`, `seller_id <>
buyer` folded into the claim's own WHERE so a self-purchase can never win
it) → a guarded gold debit on the buyer → an unconditional gold credit on
the seller → ownership transfer to the buyer, with LIFO compensations
(undo the seller credit, refund the buyer's debit, revert the claim back
to open) if anything after the won claim fails. `cancel` is the mirror:
claim (`open → cancelled`, guarded on `seller_id = caller`) → return the
good to the seller → a compensating revert of the claim if the return
fails. `GET /api/market/browse` (search/filter by kind/text/price range,
paged) deliberately lives one path segment below the bare `/api/market`
prefix — a Vercel catch-all `[...route].js` never matches its own bare
prefix, the same reason `api/activities.js` stays a plain top-level file
for its one bare route; `GET /api/market/mine` returns every listing the
caller has ever made, any status. The admin Trainers tab's
unassigned-monster pool and its Attach action both exclude monsters
escrowed in an open listing (`server/repos/monsters.js`), so an admin
can't pull a live listing's monster out from under its seller. A second,
unrelated sell path rides the existing `trainer` inventory domain instead
of the new market one: `POST /api/trainer/inventory/sell {kind:'item'|
'equipment'|'rune', defId?/id?, qty?}` is the instant, fixed-price
sell-to-system — a guarded consume (items: a `qty`-guarded stack
decrement; equipment/runes: a guarded DELETE requiring the piece be
unequipped/unsocketed) followed by a gold credit at that def's
`sell_gold` (0 = not system-sellable — the natural price floor every
marketplace listing for that def should sit above), with a compensating
restore of the removed good if the credit leg loses a race; monsters have
no `sell_gold` column and are never sellable this way — the marketplace is
their only sale path. The 🏪 Marketplace panel (`src/ui/marketplace.js`)
is two tabs — Browse (search/filter + Buy) and My Listings (Cancel, a
sold/cancelled history, and a "Sell something" picker over the trainer's
own bag/roster that calls `list`) — and the 🎒 Inventory panel's three
tabs each grow a price-labeled Sell button wherever a def's `sellGold` is
nonzero and the piece is currently unequipped/unsocketed.

Tournaments (Phase 9.2 schema/lifecycle/registration + Phase 9.3 lazy
resolution/rewards/results): `tournaments` is admin-created INSTANCE data (a
one-off scheduled event, name/description/window/rewards/entry fee), not
master content — it has no `src/data/*.js` seed file and no `npm run
db:seed` path, only the admin console's 🏆 Tournaments tab
(`POST/GET /api/admin/tournaments`, `POST /api/admin/tournaments/cancel`).
Registration is gated purely by the `[reg_starts_at, reg_ends_at]` time
window, never by `status` alone (`scheduled`/`registration` are both
registerable while the window is open). `POST
/api/battle/tournament/register {tournamentId, monsterIds}` follows the
exact claim-first-then-pay + LIFO-compensation shape `performSummon` set:
debit the optional entry fee → claim the 3-monster party's busy lock
(`busy_kind='tournament'`) → freeze the team via the same `toLane()` +
`groupByMonster()` snapshot `adventure_sessions.party` uses (gear and
socketed runes included) → insert the `tournament_entries` row (`UNIQUE
(tournament_id, trainer_id)` blocks double-registration); any failure from
a given step onward undoes every earlier step in reverse. `POST
/api/battle/tournament/withdraw {tournamentId}` is a guarded entry DELETE
(the claim itself) followed by a lock release and a fee refund, allowed
only while the window is still open. Every tournament route rides the
existing `battle` domain rather than a new serverless function
(`server/routes/tournament.js`, wired into `server/routers/battle.js`).
Admin cancel (`server/services/tournament.js`'s `adminCancel`) flips any
non-`completed` status to `cancelled` and then walks every entry through
an idempotent per-entry refund claim (`refunded` flips false→true,
guarded, factored into a shared `cancelCore()` both admin cancel and
settlement's own auto-cancel call), so re-running a cancel after a crash
never double-refunds or double-releases a lock.

Settlement (Phase 9.3) is entirely lazy (CLAUDE.md §1.5): `settleTournaments()`
runs at the top of every tournament read (list, admin list, detail). It
first bulk-flips any `scheduled` tournament whose window has opened to
`registration` (cosmetic only — registration was never gated on status). For
each tournament actually DUE (registration closed, or already `running`): a
window that closed with fewer than 2 entrants auto-cancels (the same
`cancelCore()` refund/release walk as an explicit admin cancel); otherwise a
guarded flip to `running` falls straight into settling it. There is NO
bracket JSONB column anywhere — a tournament's bracket is re-derived on
every read from (its entries' ids ordered by id ASC, its stored `seed`, and
the `tournament_matches` rows already resolved) via `shared/rules/
bracket.js`'s new `replayBracket()`, folding a durable results log back
through `generateBracket`/`nextRound`/`resolveThirdPlace` — the ONLY place a
bracket object is ever materialized. Settlement resolves exactly ONE round
per pass (bounded work per serverless invocation): every real, undecided
pairing in the bracket's current round gets `resolveBattle()` called
DIRECTLY (no `matches` row — the same `adventure.js` precedent as an
Adventure battle node) off a seed minted by `derivePairingSeed(tournament
.seed, round, position)` — a draw breaks with one more roll
(`makeRng(seed).chance(50)`) off that SAME pairing seed, still fully
deterministic and replayable — and persists via an exactly-once
`insertTournamentMatch()` claim (`UNIQUE(tournament_id, round, position)`;
a lost claim just means another settlement pass already computed the
IDENTICAL winner, so it skips re-writing it). Resolving the final round
also resolves the 3rd-place decider in the same pass, once its own two
sides are real. Once the bracket, re-derived after this pass, comes back
`complete`: `placements()` → `shared/rules/rewards.js`'s `resolveRewards()`
against this tournament's configured rewards, one idempotent
`claimEntryReward()` per entry (`reward IS NULL` is the whole gate — the
`payoutSeason` precedent, safe to re-run after a mid-payout crash), granting
through a pluggable `REWARD_GRANTERS` registry (gold credit / `grantItem` /
`grantEquipment`-or-`grantMonsterEquipment` by domain / `grantRune` /
`mintMonster` — the `performSummon` REQUIREMENT_CHECKERS precedent, one
entry per `EVENT_REWARD_TYPES` member) and releasing that entry's party
lock — THEN, only once every entry is stamped, `claimCompleteTournament()`
stamps the standings JSONB and flips `running -> completed`. Admin cancel
mid-`running` still works exactly as 9.2 designed it: whichever guarded
status flip lands first wins the race. `GET
/api/battle/tournament/detail?id=` (`getTournamentDetail()`) returns the
tournament summary, every entrant's public display info (never another
trainer's lanes) plus their stamped reward, the bracket re-derived round by
round with each pairing's seed, the 3rd-place pairing, the enriched
standings, and the caller's own entry summary — settlement runs first, so
this always reflects the freshest state. The 🏆 Tournament panel
(`src/ui/tournament.js`) is the same msgs+body, refresh-on-open shell as
Summon/Adventure: open/upcoming tournaments show the window, entry fee,
entrant count, and a plain-text rewards summary, with either a register
flow (the 3-monster party picker borrowed straight from Adventure's) or,
once registered, a "Registered" line and a Withdraw button (hidden once the
window closes); a compact history list covers anything past its window or
already running/completed/cancelled; every card/history row now also has a
"Details" button that swaps the panel body for the bracket/standings view
— round labels ("Round N" / "Semifinals" / "Final" / "3rd-place match"),
byes rendered as "bye", and a running tournament's still-unplayed pairings
marked "pending".

Guilds (Phase 9.4): `guilds`/`guild_members`/`guild_applications` are
player-created INSTANCE data, not master content — a guild is a one-off
thing a trainer founds (like a tournament), not reusable balance content, so
there's no `src/data/*.js` seed file and no admin console tab at all; the
only "admin" surface is the ordinary player-facing flow itself. `guild_id`/
`trainer_id` UNIQUE on `guild_members` is THE one-guild-per-trainer
invariant every join path (create, an accepted application) 23505s against
at the DB layer, not just a service-side pre-check. Application flow, not
invites: a guildless trainer `POST /api/guild/apply {guildId, message?}`s to
a guild; the guild's LEADER (only) `accept`s or `reject`s — there is no
status column on `guild_applications`, a pending application IS a row's
existence, so both actions are just a guarded DELETE (accept also inserts
the membership row first). The 8th domain — `api/guild/[...route].js` +
`server/routers/guild.js`, the second sanctioned reason (after the
marketplace) to add a new top-level `api/` entry, CLAUDE.md §5 — covers
`browse`/`me`/`create`/`apply`/`accept`/`reject`/`leave`/`kick`/`promote`/
`transfer`. EVERY write in `server/services/guild.js` re-derives the
caller's OWN role from `guild_members` via `getMembership()` first — a role
is never trusted from the request body (CLAUDE.md §1.1); accept/kick/
promote/reject/transfer are leader-only (403 otherwise), and a plain member
never even sees the pending-application queue (`me()`'s `applications` key
is present only when the caller's role is `'leader'` or `'officer'` — an
officer sees it read-only, only the leader can act on it this phase).
`create` follows the exact claim-first-then-pay + LIFO-compensation shape
`performSummon` set: `debitGold(GUILD_CREATE_COST)` (500, 409 "not enough
gold" on a lost claim) → `insertGuild` (a case-insensitive duplicate name
23505s → refund → 409 "guild name is taken") → `insertMember(role:
'leader')` (a failure here deletes the just-created guild THEN refunds the
gold, LIFO) → the founder's own stale pending applications (if any) are
cleaned up on success. `leave`/`kick`/`updateMemberRole` are all guarded
statements that exclude `role = 'leader'` from their WHERE
(`server/repos/guilds.js`) — a leader can never leave (even solo;
disbanding a guild outright is out of scope this phase, documented as such)
or be kicked/demoted directly; the ONLY way the `'leader'` role moves is
`transfer`'s `claimTransferLeadership` — a guarded `guilds.leader_id` UPDATE
(the real claim: a lost race means someone already transferred first) that,
only once won, swaps both member rows' roles in the same sequence (new
leader → `'leader'`, old leader → `'officer'`). The 🏰 Guild panel
(`src/ui/guild.js`) is the same msgs+body, refresh-on-open shell as
Tournament/Summon/Adventure, rendering three shapes off one `fetchGuildMe()`
read: guildless (my pending applications, a browse list with Apply/Applied
per guild, and a "Found a guild" form labeled with the gold cost); member/
officer (guild header, full roster with role badges, a Leave button;
officers additionally see the pending-application queue read-only); leader
(all of the above, plus per-application Accept/Reject and per-member,
non-self Kick/Promote/Demote/"Make leader" — transfer confirm()-gated —
controls, with the leader's own Leave replaced by a "transfer first" hint).

GVG events (Phase 9.5): the tournament event lifecycle re-instantiated at
guild level — setup-side only this sub-phase (no bracket, no battles; 9.6
lands the one engine change those need, 9.7 resolves wars). `017_gvg.sql`:
`gvg_events` (admin-created instance data exactly like `tournaments` — same
`validateEventSchedule`/`validateEventRewards` grammar via the new
`validateGvgEvent`, plus `minTeams`/`maxTeams` bounds 1-10, no entry fee),
`gvg_teams` (one row per trainer's submitted team — `guild_id` freezes the
submitter's guild AT SUBMISSION time; `team` is the exact
`tournament_entries.team`/`adventure_sessions.party` `{lanes, display}`
shape; `battle_order` NULL until the leader picks it into the lineup;
`released` is the idempotent lock-release flag, the `refunded` role minus a
refund leg since GVG has no fee), `gvg_registrations` (one per guild per
event, `UNIQUE(event_id, guild_id)`), and `gvg_wars` (schema only — Phase
9.7 is its first writer, kept here so GVG has one migration to read start to
finish, the `tournament_matches` precedent). Every route rides the EXISTING
guild domain (`/api/guild/gvg/events|submit|withdraw|lineup|register` —
`server/routes/gvg.js`, wired into `server/routers/guild.js`) — no new
serverless function. `submitTeam` follows tournament registration's exact
claim-first-then-pay shape minus the fee leg: claim the party's busy lock
(`busy_kind='gvg'`) → freeze the `toLane()` snapshot → insert the team, with
compensating release on any failure. The LEADER (only, role re-derived via
`getMembership()` first, CLAUDE.md §1.1) stages a lineup with `setLineup`
(clears then re-sets each team's `battle_order`, 1-based, order IS the relay
order) and then `registerGuild` (409 unless the lineup's count sits within
`[minTeams, maxTeams]` with contiguous order). `settleGvg()` — called
lazily at the top of every GVG read, the `settleTournaments`/`settleActivities`
precedent — opens due registration windows cosmetically and, once a window
closes, releases every submitted-but-unpicked team's lock plus every team
belonging to a guild that never completed registration; a picked team
belonging to a registered guild stays locked for 9.7's eventual war to
release (9.7, below, is what actually walks a `running` event). Admin cancel
(`⚔ GVG` tab, mirroring `🏆 Tournaments`) releases
every team's lock at any non-completed status, idempotently. The 🏰 Guild
panel's new "⚔ Guild vs. Guild" section (`src/ui/guild.js`) is the same
msgs+body shell as the rest of the panel: any member sees open events with a
3-monster team-submit picker (borrowed from `ui/tournament.js`'s party
picker) and their own submission status; the LEADER additionally sees every
submitted team with a per-team lineup-order `<input>`, a "Save lineup"
button, and "Register guild"/"Registered ✓". Pure display + action over
`src/services/content.js`'s new `fetchGvgEvents()`/`submitGvgTeam()`/
`withdrawGvgTeam()`/`setGvgLineup()`/`registerGvgGuild()` — every validity
check (role, window, team-count bounds, contiguous order) is the server's
job, never re-derived client-side.

## 4. Recipes for TODAY's code

- **Add a species / skill / class / job (live):** admin console (⚙ button)
  — validated writes straight to the master tables, no redeploy. The
  `src/data/*.js` routes below still work for content meant to ship with
  the repo (they seed via `npm run db:seed`, which overwrites same-id rows).
- **Add a species:** entry in `src/data/units.js` (ROSTER_A = starters,
  ROSTER_B = wild pool), then `npm run db:seed` to upsert `monster_species`.
- **Add sprite art:** sheet per `public/sprites/TEMPLATE.md` (96px cells,
  rows idle/attack/defend/dead ×4 frames) → `public/sprites/units/uNN.png` →
  entry in `src/data/sprites.js` → `sprite: "uNN"` on the def.
- **Add a unit class:** `data/classes.js` entry → `cutscene/portraits.js`
  case → `cutscene/effects.js` case + `.fx-<fx>` keyframes in
  `styles/cutscene.css` → use in a roster.
- **Add a skill:** row in `src/data/skills.js` (power/target/onHit/support/
  passive grammar) → assign in a species' `skills` in `units.js` →
  `npm run db:seed`. No engine change. New status id or targeting rule ⇒ one
  entry in `shared/rules/statuses.js` / `targeting.js`.
- **Add a job:** row in `src/data/jobs.js` (work: `{gold, trainerExp}` |
  training: `{attr, gain}`) → `npm run db:seed`. No code change — settlement
  interprets rewards by kind; `tests/jobs.test.mjs` guards the grammar.
- **Add an item / equipment piece / rune (live):** admin console (🎒/⚔/🔮
  tabs) — validated writes straight to the master tables, no redeploy. Or a
  row in `src/data/items.js` / `equipment.js` / `runes.js` + `npm run
  db:seed` for content meant to ship with the repo. Equipment/rune `effects`
  must stay within the `battle_start`/`perm_stat` grammar (`perLevel`
  allowed) until a later phase widens the op set. Every def also carries a
  `sellGold` (Phase 8, admin-editable live like every other field in the
  same tab): the flat per-unit price `POST /api/trainer/inventory/sell`
  credits when a player instant-sells one to the system; 0 (the default)
  means not system-sellable at all — the marketplace remains the only way
  to turn it into gold.
- **Add a summon banner (live):** admin console (✨ Summons tab) — validated
  writes straight to `summon_defs`, no redeploy. Or a row in
  `src/data/summons.js` + `npm run db:seed` for content meant to ship with
  the repo. `cost` entries must use a registered type (`gold`, `item` —
  `server/services/adminValidate.js`'s `SUMMON_COST_TYPES`), and every `pool`
  `speciesId` must name a real `monster_species` row.
- **Add an adventure route (live):** admin console (🗺 Adventures tab) —
  validated writes straight to `adventure_defs`, no redeploy. Or a row in
  `src/data/adventures.js` + `npm run db:seed` for content meant to ship
  with the repo. `config`'s grammar (steps/choices/nodes/encounters/loot/
  gather/catchPct) is documented in that file's header and enforced by
  `validateAdventure()`; a new node TYPE (beyond `battle`/`chest`/`gather`)
  needs one more `ADVENTURE_NODE_TYPES` entry AND one more `NODE_RESOLVERS`
  entry in `server/services/adventure.js` — never a branch in `move()`.
- **Give a monster to an account (live):** admin console (👥 Trainers tab) —
  two paths. Either pick the trainer, pick a species, Mint (copies base
  stats/attrs/skill loadout from the species master row, same mint as the
  Summon Hall), or pick the trainer, pick from the unassigned-monster pool,
  Attach (links an already-grown, ownerless instance instead of minting a
  fresh one). Note: a monster's "Remove" button is the inverse — it detaches
  rather than deletes, so the monster persists unassigned (ready to Attach
  elsewhere) and is blocked with 409 while busy or in a saved PVP defense
  formation.
- **Add a stat:** attrs live in `monster_species`/`monsters` (new migration);
  derived stats in `shared/rules/formulas.js` `deriveStats()`; consumed via
  `toLane()` in `server/services/matches.js` → card markup in `ui/board.js`.
- **Change balance:** numbers in `shared/rules/` + `src/data/` only; golden
  tests will diff — regenerate intentionally in the same commit.

## 5. Conventions

- Keep **core logic DOM-free**; pass UI behavior in as hooks (see `runBattle`).
- One module = one responsibility; if a file does two jobs, split it.
- Route handlers stay thin (parse → validate → logic → respond); each
  domain's router (`server/routers/<domain>.js`) owns method checks and the
  error→JSON envelope via `createRouter()`.
- New route in an existing domain = one row in that domain's table in
  `server/routers/<domain>.js`; a genuinely new domain = new
  `api/<domain>/[...route].js` + `server/routers/<domain>.js` — the only
  time to add a file under `api/` (Vercel deploys each top-level `api/`
  entry as another serverless function, and the Hobby plan caps a
  deployment at 12; today's 8 domains leave room for ~1 more).
- Faction colors are synced in two places: CSS vars `--a`/`--b` in
  `styles/base.css` and `COLORS` in `src/config.js`. Update both.
- Cutscene keyframes are authored against a **2.1s timeline, impact ~66%**;
  keep `CUTSCENE` timings in `config.js` in sync.
- Stable string ids (`sprite:"u01"`, class/species/skill ids) are the DB keys
  — never renumber them.
- After non-trivial changes run `npm run build` and `npm test`; engine
  changes require the golden-log tests to pass (or be intentionally
  regenerated in the same commit).
- Schema changes are NEW files in `db/migrations/` — never edit an applied
  migration.
- When a change alters an interface described in `docs/`, update the doc in
  the same change.

## 6. Known gaps (today)

- Teams fixed at 3; no DEF/mitigation stat. Equipment (Phase 7.2) and runes
  (Phase 7.3) are both fully live now: equipping/socketing, enhance/repair,
  and feeding battle snapshots (including runes' `battle_start` effects and
  `target_select` targeting overrides, with post-battle durability wear on
  the attacking side) all work end to end. Trainer skills DO join battle
  (Phase 6, `battle_start`/`after_ally_turns` triggers), and so does
  trainer-domain equipment (PVP-only, same parity as trainer skills).
- Battle wins still award nothing directly OUTSIDE Adventure (gold/exp come
  from work jobs only; PVP moves rating only, no gold/exp) — season-end
  payouts are the one lazy/passive exception. An Adventure battle-node win is
  the one direct exception: it can mint a caught monster (`catchPct` roll) on
  top of the run's loot. Monsters have no level/exp of their own — training
  raises attributes directly. Gold now circulates player-to-player, not just
  faucet → sink: the 🏪 Marketplace (Phase 8) lets a trainer buy any listed
  item/equipment/rune/monster from another trainer at their own asking
  price, and the 🎒 Inventory panel's instant sell-to-system path turns
  unwanted items/equipment/runes straight back into gold at a fixed per-def
  floor price (`sellGold`, 0 = not sellable that way) — monsters are
  marketplace-only, never system-sellable. Acquisition still has its two
  Phase 7.4 player-facing paths (the ✨ Summon Hall mints a monster per pull;
  the 🗺 Adventure panel sends a 3-monster party down a route for loot and a
  chance at a caught monster), and the marketplace is now a third way to
  acquire — but the admin-gated `POST /api/admin/grant` remains the only
  FAUCET putting items/equipment/runes into the economy in the first place
  (besides Adventure loot); the marketplace and sell-to-system only move
  gold/goods that already exist, they never mint new ones.
- Opponents in a `mode:"pvp"` match ARE real trainers' saved defense
  formations now (matched by rating proximity); free matches (default mode)
  are still random species teams. No sound.
- Migration runner splits statements on `;` after stripping full-line
  comments — don't put semicolons inside inline `--` comments in migrations.
