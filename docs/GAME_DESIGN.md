# Game Design — working title "Battle Line" (evolving into the Trainer game)

This is the WHAT: the game we are building. The HOW (code structure, schema,
engine) is in [ARCHITECTURE.md](./ARCHITECTURE.md); the WHEN is in
[ROADMAP.md](./ROADMAP.md). Sections marked **⚠ open** are not decided yet —
don't build them without resolving the question first.

## 1. Vision

A web-based tactics game where the player is a **Trainer** who owns, raises,
and equips **Monsters (Units)**, arranges them into a **formation**, and pits
that formation against other players' formations in auto-resolved battles.
Inspiration: Front Mission (loadout/formation tactics) + Monster Rancher
(raising monsters through scheduled activities) + Heroes of Might & Magic
(army composition & stacked modifiers).

Player agency lives **before** the fight: which monsters, in what order, with
what skills, runes, equipment, and trainer buffs. The battle itself is
deterministic-with-seeded-randomness, resolved on the server, and replayed as
an animation on the client. Nothing the client sends can change an outcome.

The loop: **earn (work) → improve (train / equip / summon) → prove (arena) →
rank (seasons) → repeat.**

## 2. The Trainer (the account)

- Created automatically on first login (Google sign-in or similar).
- Has **exp** (from battles, work completions, tournaments) and **gold** (the
  soft currency; earned from work, battles, selling on the marketplace).
- At an exp threshold the trainer picks an **Expertise Area** (Warrior,
  Wizard, Shaman, …). Expertise unlocks a pool of **Trainer Skills**.
- **Trainer Skills:** each expertise offers many skills; the trainer has
  **2 learn slots** (a build choice). Skills have their own levels and scale
  with level (percentages, amounts). Effects are battle-wide or activity-wide,
  e.g. "at battle start all your monsters gain +10% DEF", "+5% crit chance for
  all your monsters", "after all your units have acted, heal the lowest-HP
  unit for N".
- **Switching expertise wipes all learned trainer skills** (deliberate cost).
- Trainer has **artifact slots** on a body layout; artifacts grant attributes
  or skills.
- Trainer equipment is separate from monster equipment (separate tables, see
  ARCHITECTURE).

## 3. Monsters

Master/instance split (see ARCHITECTURE §data): a **species master** row is
the baseline; an **owned monster** row is a per-trainer copy that mutates as
the monster grows. Reset = re-copy from master.

Per monster:
- **Attributes:** STR, AGI, VIT, INT, DEX (primary) → derive HP, ATK min/max,
  MATK min/max, hit/evade, crit, and **SPD**.
- **SPD** drives turn order: faster units act first and act again sooner
  (see §7 battle system). Acting resets the unit's readiness.
- **Class** (depends on monster type) and **Element**: Neutral, Fire, Water,
  Wind, Earth, Holy, Dark, with an advantage chart.
- **Attack type:** Melee (can only hit the front) or **Range** with a
  targeting pattern (random enemy / the slot behind the front / the last slot
  first / the last two slots / …). Range attacks against the front (or
  near-front) positions are penalized to **25% attack power** — range's job is
  to bypass the front line, not to duel it.
- **Skill slots (4):** Passive #1, Passive #2, Normal, Ultimate. Slots may be
  empty; more slots may be added later.
- **Rune slots:** varies per monster (1 for some, 2 for others).

## 4. Skills (monster) & status effects

- Skills are **master data**, shared: monster A and monster B can both learn
  skill X. A monster's learned skill carries its own **level**; per-level
  scaling lives with the skill master data.
- Skills apply **status effects**: Stun (skip your turn), Freeze (can't evade),
  Burn (damage per turn), Poison, Curse, … — an open set. Statuses are data
  (trigger + operation + magnitude + duration), not hardcoded branches, so new
  ones are content rows. See ARCHITECTURE §effects.

## 5. Runes & Equipment

- **Runes** modify how an attack behaves — e.g. a Range monster's multi-target
  attack gains "prioritize lowest HP%". Runes have a **level** (stronger
  effect / success chance) and a **charge limit**: each trigger consumes a
  charge; at 0 the rune **breaks**, is removed from the monster, and must be
  repaired.
- **Equipment** exists for trainers and for monsters (separate instance
  tables). Grants effects in battle and in exploration. Can be **enhanced**
  to raise its effect.

## 6. Activities (the out-of-battle loop)

All timed activities follow one pattern: the monster is **locked** for a
duration, the completion time is stored, and rewards are resolved lazily when
the player next looks (no live timers server-side — ARCHITECTURE §time).

1. **Work** — send monsters to earn gold (mainly benefits the trainer).
   Different jobs have different durations; some jobs unlock by condition.
2. **Training** — like work, but rewards go to the **monster**: attributes,
   skills, unlocks. Lock behavior can depend on class requirements.
3. **Adventure** — explore a per-session randomly generated map/dungeon with a
   party; the player picks directions. Yields materials, items, equipment,
   artifacts, and monster catches, by area & difficulty.
   **⚠ open:** interaction transport. Start with plain request/response
   (POST a step, get the result — the map session lives in the DB); consider
   websockets only if a truly realtime mode appears.
4. **Battle Arena**
   - **Free Play** — pick an opponent, no rewards.
   - **PVP** — ranked ladder within your rank bracket; points; seasonal
     rewards by final rank. Asynchronous: you fight the **stored defense
     formation** of another player, they don't need to be online.
   - **Tournament** — entry criteria; bracket auto-resolved by the server.
   - **GVG** — guild leader picks member teams; guild vs guild.
5. **Summon Hall** — summon monsters when a condition is met: items, gold,
   quest completions.
   **⚠ open (high risk):** the "photo quest" idea — daily/weekly hint, players
   upload a photo, server scores the match quality, rewards by percentile
   (<1%, 1–20%, 20–50%, 50–100%). This needs image-AI scoring, content
   moderation, and abuse handling. Parked at the end of the roadmap; design
   the quest system so the *scorer* is pluggable.
6. **Marketplace** — list monsters/items for sale, buy from others (gold).
7. **Messages & notifications** — player-to-player and system messages.

## 7. Battle system (revised flow — the reference)

> This section supersedes the "check everything each phase" draft. Full
> mechanics of the engine are in ARCHITECTURE §engine; this is the rules-level
> description.

The model is a **readiness (ATB) loop with a fixed turn pipeline**:

1. **Battle start** — build both teams from authoritative DB state (monsters,
   skills, runes, equipment, trainer skills). Fire every `battle_start`
   effect in a fixed, deterministic order (trainer skills → passives →
   equipment → runes). Seed the RNG; the seed is stored with the match.
2. **Readiness loop** — every unit has an action gauge that fills by its
   effective SPD; the unit that crosses the threshold acts (ties broken by
   seeded RNG so PVP is fair). Acting **subtracts the threshold** (overflow
   carries, so haste/slow mid-fight behave correctly). This is exactly the
   "speed resets after action and gets recalculated" idea, formalized.
3. **One unit's turn — always the same pipeline:**
   1. *turn_start:* tick statuses (burn/poison damage, durations), reduce
      this unit's skill cooldowns.
   2. *control check:* stunned/frozen? Emit a "skipped" event, end turn.
   3. *choose action:* Ultimate if off cooldown, else Normal (policy is data,
      so smarter AI policies can be added later).
   4. *choose targets:* by the attack/skill's targeting rule (front for
      melee; the range patterns of §3), modified by runes.
   5. *resolve per target:* hit check (freeze disables evade) → damage roll
      (ATK min–max, seeded) × element × crit × mitigation → apply → on-hit
      status applications → rune triggers (consume a charge; break at 0) →
      deaths.
   6. *turn_end:* post-effects, recompute derived stats for everyone.
4. **End** — a side has no living units, or a **turn cap** (draw rule) hits so
   battles always terminate.

Every step emits an **event** into the log; the client animates the log.
Trainer skills and monster skills both live in this same effect system, each
with its own cooldown domain.

## 8. Design principles (rules for adding content)

- New content should be **rows, not branches**: a new skill, status, rune, or
  job is data interpreted by a small fixed set of engine operations.
- Anything that affects an outcome (battle, work reward, summon result) is
  computed **on the server from DB state**. The client's inputs are choices
  (orders, formations, which job), never values.
- Every random outcome uses a **stored seed** so any result can be replayed
  and audited.
- Balance numbers (percentages, durations, costs) belong in master-data
  tables, not constants in code.
