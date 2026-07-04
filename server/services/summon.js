// Summon Hall use-cases (Phase 7.4 step A, acquisition). The client sends
// exactly ONE choice — which banner (summonId) — and nothing else: pay legs,
// the RNG seed, and the drawn species are all decided/rolled HERE, never
// trusted from the request body (CLAUDE.md §1.1).
//
// REQUIREMENT_CHECKERS is the pluggable-cost interface a summon_defs.cost
// entry's `type` dispatches through: pay() spends one leg, refund() gives it
// back if a LATER leg in the same pull fails to pay. Adding a new cost kind
// (a future "quest" requirement) is one new registry entry — never a branch
// in performSummon() itself, same closed-op-set philosophy the engine uses
// for skills/statuses (CLAUDE.md §1.4).

import { httpError } from "../http.js";
import { rollSummon } from "../../shared/rules/summon.js";
import { listEnabledSummonDefs, getSummonDef, insertSummon } from "../repos/summons.js";
import { getSpeciesById } from "../repos/species.js";
import { mintMonster, unmintMonster, getMonsterById } from "../repos/monsters.js";
import { debitGold, refundGold, getTrainerById } from "../repos/trainers.js";
import { consumeItem as consumeItemRepo, grantItem as grantItemRepo } from "../repos/inventory.js";
import { getInventory } from "./inventory.js";

const REQUIREMENT_CHECKERS = {
  gold: {
    pay: (sql, trainerId, req) => debitGold(sql, trainerId, req.amount),
    refund: (sql, trainerId, req) => refundGold(sql, trainerId, req.amount),
  },
  item: {
    pay: (sql, trainerId, req) => consumeItemRepo(sql, trainerId, req.itemId, req.qty),
    refund: (sql, trainerId, req) => grantItemRepo(sql, trainerId, req.itemId, req.qty),
  },
};

/** The banners a trainer can pull from right now (disabled ones excluded). */
export async function listSummonHall(sql) {
  return listEnabledSummonDefs(sql);
}

/**
 * Refund every already-paid leg, reverse order (LIFO) — the one compensation
 * loop both the failed-pay-leg path and the post-payment catch below share,
 * so this logic exists exactly once.
 */
async function refundPaid(sql, trainerId, paid) {
  for (let i = paid.length - 1; i >= 0; i--) {
    const done = paid[i];
    await REQUIREMENT_CHECKERS[done.type].refund(sql, trainerId, done);
  }
}

/**
 * Pull one banner: pay its cost (claim-first-then-pay, same shape as
 * server/services/equipment.js enhance() — each leg's own atomic
 * claim query is the gate, and a leg failing after earlier legs already
 * succeeded triggers a compensating refund of everything paid so far rather
 * than leaving a partial charge in place), roll a species from its pool with
 * a freshly minted seed, mint the monster, and write the audit row.
 *
 * The seed-mint-through-insertSummon span is wrapped so a failure there (an
 * unknown-species pool, a DB hiccup on insertSummon, ...) can never leave
 * gold/materials spent with nothing minted — same "never leave a partial
 * charge in place" guarantee the pay loop itself gives. That span is ALSO
 * the only place a monster gets minted, so the catch undoes the mint too
 * (when one happened) before refunding the cost — otherwise a failure right
 * after mintMonster would refund the gold but leave the free monster
 * sitting in the roster. The final reads (and the return) sit OUTSIDE the
 * try: once insertSummon has committed, the pull is fully delivered, and a
 * failure reading it back afterward must not un-charge a trainer who did
 * receive their monster.
 * @param {{summonId:string}} body the ONLY thing the client contributes
 * @returns {{summonId:string, seed:number, monster:object, gold:number, inventory:object}}
 */
export async function performSummon(sql, trainerId, body) {
  const summonId = body?.summonId;
  if (typeof summonId !== "string" || !summonId) throw httpError(400, "summonId is required");

  const def = await getSummonDef(sql, summonId);
  // 404 for both "no such banner" and "disabled" — a retired banner must not
  // leak that it ever existed, same precedent as equipment's ownership 404s.
  if (!def || !def.enabled) throw httpError(404, "unknown summon");

  const paid = [];
  for (const req of def.cost) {
    const checker = REQUIREMENT_CHECKERS[req.type];
    // A cost row can reach the DB with no matching checker (hand-written SQL,
    // or a def seeded before its checker shipped) — refuse it BEFORE calling
    // .pay() on undefined, and refund anything already paid this pull.
    if (!checker) {
      await refundPaid(sql, trainerId, paid);
      throw httpError(500, `summon cost names an unregistered requirement type "${req.type}"`);
    }
    const ok = await checker.pay(sql, trainerId, req);
    if (!ok) {
      await refundPaid(sql, trainerId, paid);
      throw httpError(409, "summon failed — check gold or materials");
    }
    paid.push(req);
  }

  let seed, resultSpeciesId, monsterId;
  try {
    // Determinism means a STORED seed, not a deterministic seed choice — same
    // precedent as match creation (server/services/matches.js createMatch()).
    seed = Math.floor(Math.random() * 0x7fffffff);
    resultSpeciesId = rollSummon(def.pool, seed);

    const species = await getSpeciesById(sql, resultSpeciesId);
    if (!species) {
      throw httpError(500, "summon pool references an unknown species — is master data seeded?");
    }

    monsterId = await mintMonster(sql, trainerId, species);
    await insertSummon(sql, {
      trainerId, summonId: def.id, cost: def.cost, pool: def.pool,
      seed, resultSpeciesId, monsterId,
    });
  } catch (err) {
    // Every leg was already paid — a failure from here on (unknown pool
    // species, a DB hiccup on mint/insert) must not leave the trainer
    // charged for nothing, so undo the mint (if it happened) and the whole
    // pay loop before rethrowing.
    if (monsterId) await unmintMonster(sql, trainerId, monsterId);
    await refundPaid(sql, trainerId, paid);
    throw err;
  }

  // insertSummon committed: the pull is fully delivered from here on, so a
  // failure in these reads must NOT refund/unmint — the trainer already has
  // both the monster and the debited cost, only the response would be stale.
  const [monster, trainer, inventory] = await Promise.all([
    getMonsterById(sql, trainerId, monsterId),
    getTrainerById(sql, trainerId),
    getInventory(sql, trainerId),
  ]);

  return { summonId: def.id, seed, monster, gold: trainer.gold, inventory };
}
