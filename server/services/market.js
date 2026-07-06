// Marketplace use-cases (Phase 8): list/buy/cancel/browse. Same
// claim-first-then-pay family as equipment's enhance()/runes' repair()/
// summon's performSummon() — every escrow and every ownership transfer is a
// single guarded statement (server/repos/market.js), and a failure after a
// claim already won triggers a compensating revert/refund rather than
// leaving a partial trade in place. See db/migrations/013_marketplace.sql's
// header and docs/ROADMAP.md's "Phase 8 — Marketplace" section for the full
// design this implements.

import { httpError } from "../http.js";
import {
  insertListing, getListingById, claimSold, revertSaleClaim, claimCancelled, revertCancelClaim,
  browseListingsRepo, myListingsRepo,
  getOwnedEquipmentInstance, escrowTrainerEquipment, escrowMonsterEquipment,
  assignTrainerEquipmentOwner, assignMonsterEquipmentOwner,
  getOwnedRuneInstance, escrowRune, assignRuneOwner,
  getMonsterListingBlockers, escrowMonster, assignMonsterOwner,
} from "../repos/market.js";
import {
  getItemDef, consumeItem as consumeItemRepo, grantItem as grantItemRepo, getEquipmentDomain,
} from "../repos/inventory.js";
import { debitGold, refundGold, getTrainerById } from "../repos/trainers.js";

const LISTING_KINDS = ["item", "equipment", "rune", "monster"];
const MAX_PRICE = 1_000_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// --- browse / mine -------------------------------------------------------------

/**
 * @param {{kind?:string, q?:string, minPrice?:string|number, maxPrice?:string|number,
 *   limit?:string|number, offset?:string|number}} query raw querystring values
 *   (everything arrives as a string from req.url — normalized here, never
 *   trusted as already-typed).
 */
export async function browseListings(sql, query = {}) {
  const kind = LISTING_KINDS.includes(query.kind) ? query.kind : null;
  const q = typeof query.q === "string" && query.q.trim() ? query.q.trim() : null;

  const minPrice = toPositiveIntOrNull(query.minPrice);
  const maxPrice = toPositiveIntOrNull(query.maxPrice);

  let limit = Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  let offset = Number(query.offset);
  if (!Number.isInteger(offset) || offset < 0) offset = 0;

  const listings = await browseListingsRepo(sql, {
    kind, q: q ? `%${q}%` : null, minPrice, maxPrice, limit, offset,
  });
  return { listings };
}

function toPositiveIntOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Every listing this trainer has ever created, any status. */
export async function myListings(sql, trainerId) {
  return { listings: await myListingsRepo(sql, trainerId) };
}

// --- list ------------------------------------------------------------------

/**
 * List one good for sale: validate the shared fields, then dispatch to the
 * kind-specific escrow flow. Each flow's shape is claim-first (one guarded
 * escrow statement) then insert the listing row; if the INSERT fails, the
 * escrow is reversed (same "never leave a partial charge" guarantee as
 * summon's unmint/refund).
 * @param {{kind:string, refId?:number, defId?:string, qty?:number, price:number}} body
 * @returns {{listing:object, listings:object[]}} the created listing + this
 *   seller's refreshed listing list (same "hand back what changed" precedent
 *   as equip()/enhance() returning the refreshed inventory read).
 */
export async function createListing(sql, trainerId, body) {
  const { kind, refId, defId, qty, price } = body ?? {};
  if (!LISTING_KINDS.includes(kind)) throw httpError(400, `kind must be one of: ${LISTING_KINDS.join(", ")}`);

  const priceInt = Number(price);
  if (!Number.isInteger(priceInt) || priceInt <= 0 || priceInt > MAX_PRICE) {
    throw httpError(400, `price must be a positive integer up to ${MAX_PRICE}`);
  }

  if (kind === "item") return listItem(sql, trainerId, { defId, qty, price: priceInt });
  if (kind === "equipment") return listEquipment(sql, trainerId, { refId, price: priceInt });
  if (kind === "rune") return listRune(sql, trainerId, { refId, price: priceInt });
  return listMonster(sql, trainerId, { refId, price: priceInt });
}

async function afterListed(sql, trainerId, listing) {
  return { listing, listings: await myListingsRepo(sql, trainerId) };
}

async function listItem(sql, trainerId, { defId, qty, price }) {
  if (typeof defId !== "string" || !defId) throw httpError(400, "defId is required");
  const n = qty === undefined ? 1 : Number(qty);
  if (!Number.isInteger(n) || n < 1) throw httpError(400, "qty must be a positive integer");

  const def = await getItemDef(sql, defId);
  if (!def) throw httpError(404, `unknown item "${defId}"`);

  // Escrow claim: the guarded stack decrement IS the whole gate.
  const consumed = await consumeItemRepo(sql, trainerId, defId, n);
  if (!consumed) throw httpError(409, "not enough of that item");

  try {
    const listing = await insertListing(sql, {
      sellerId: trainerId, kind: "item", defId, refId: null, qty: n, price,
    });
    return afterListed(sql, trainerId, listing);
  } catch (err) {
    // Compensate: give the stack back, same spirit as summon's refundPaid.
    await grantItemRepo(sql, trainerId, defId, n);
    throw err;
  }
}

async function listEquipment(sql, trainerId, { refId, price }) {
  const id = Number(refId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "refId must be a positive integer");

  // Read-only precheck: which table (domain) owns this id, and its def —
  // never the gate itself (the escrow* call below is).
  const instance = await getOwnedEquipmentInstance(sql, trainerId, id);
  if (!instance) throw httpError(404, "equipment not found");

  const escrow = instance.domain === "trainer" ? escrowTrainerEquipment : escrowMonsterEquipment;
  const unescrow = instance.domain === "trainer" ? assignTrainerEquipmentOwner : assignMonsterEquipmentOwner;

  const escrowed = await escrow(sql, trainerId, id);
  if (!escrowed) throw httpError(409, "unequip it first");

  try {
    const listing = await insertListing(sql, {
      sellerId: trainerId, kind: "equipment", defId: escrowed.def_id, refId: id, qty: 1, price,
    });
    return afterListed(sql, trainerId, listing);
  } catch (err) {
    await unescrow(sql, id, trainerId);
    throw err;
  }
}

async function listRune(sql, trainerId, { refId, price }) {
  const id = Number(refId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "refId must be a positive integer");

  const instance = await getOwnedRuneInstance(sql, trainerId, id);
  if (!instance) throw httpError(404, "rune not found");

  // Broken runes ARE listable — only "still socketed" blocks the escrow.
  const escrowed = await escrowRune(sql, trainerId, id);
  if (!escrowed) throw httpError(409, "unsocket it first");

  try {
    const listing = await insertListing(sql, {
      sellerId: trainerId, kind: "rune", defId: escrowed.def_id, refId: id, qty: 1, price,
    });
    return afterListed(sql, trainerId, listing);
  } catch (err) {
    await assignRuneOwner(sql, id, trainerId);
    throw err;
  }
}

async function listMonster(sql, trainerId, { refId, price }) {
  const id = Number(refId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "refId must be a positive integer");

  // Pre-check each obligation separately so the 409 names what blocks it —
  // the guarded escrowMonster() UPDATE below folds all of these into ONE
  // atomic statement and is the real gate; this is diagnostics only, same
  // spirit as the admin detach route's getMonsterDetachDiagnostic.
  const blockers = await getMonsterListingBlockers(sql, id);
  if (!blockers || Number(blockers.trainer_id) !== trainerId) throw httpError(404, "monster not found");
  if (blockers.busy_until && new Date(blockers.busy_until) > new Date()) {
    throw httpError(409, `monster is busy (${blockers.busy_kind})`);
  }
  if (blockers.in_formation) {
    throw httpError(409, "monster is in your defense formation — remove it there first");
  }
  if (blockers.has_equipment) throw httpError(409, "strip its equipment first");
  if (blockers.has_runes) throw httpError(409, "unsocket its runes first");

  const escrowed = await escrowMonster(sql, trainerId, id);
  // Every precondition was already confirmed above — a lost claim here can
  // only mean a race changed one of them between the precheck and now.
  if (!escrowed) throw httpError(409, "listing failed — try again");

  try {
    const listing = await insertListing(sql, {
      sellerId: trainerId, kind: "monster", defId: escrowed.species_id, refId: id, qty: 1, price,
    });
    return afterListed(sql, trainerId, listing);
  } catch (err) {
    await assignMonsterOwner(sql, id, trainerId);
    throw err;
  }
}

// --- buy ---------------------------------------------------------------------

/**
 * Buy one open listing. Order (ROADMAP Phase 8): read + pre-checks, claim
 * (open -> sold, `seller_id <> buyer` folded into the claim itself), debit
 * the buyer, credit the seller, transfer the good. A failure at any step
 * from the debit onward triggers a LIFO compensation chain so a lost race
 * never leaves gold or goods stuck mid-transfer.
 * @param {{listingId:number}} body
 * @returns {{listing:object, gold:number}} the closed listing + the buyer's
 *   new gold balance.
 */
export async function buyListing(sql, trainerId, body) {
  const listingId = Number(body?.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) throw httpError(400, "listingId must be a positive integer");

  const existing = await getListingById(sql, listingId);
  if (!existing) throw httpError(404, "listing not found");
  if (existing.status !== "open") throw httpError(409, "already sold or cancelled");
  if (existing.sellerId === trainerId) throw httpError(409, "can't buy your own listing");

  // The claim itself re-checks `status = 'open' AND seller_id <> buyer` —
  // the reads above are for a clean error message, not the actual gate.
  const claimed = await claimSold(sql, listingId, trainerId);
  if (!claimed) throw httpError(409, "already sold or cancelled");

  const debited = await debitGold(sql, trainerId, claimed.price);
  if (!debited) {
    await revertSaleClaim(sql, listingId, trainerId);
    throw httpError(409, "not enough gold");
  }

  try {
    // Credit the seller — refundGold is a generic unconditional wallet add
    // (server/repos/trainers.js), used here as "pay the seller" rather than
    // its usual "give a spent leg back" role.
    await refundGold(sql, claimed.sellerId, claimed.price);
    await transferGood(sql, claimed, trainerId);
  } catch (err) {
    // LIFO: undo the seller credit (an unconditional subtract — compensation
    // only, so it isn't gated on the seller still holding that gold, same
    // "accepted" risk class as server/services/matches.js's post-claim NOTE),
    // refund the buyer's debit, then revert the sale claim back to open.
    await refundGold(sql, claimed.sellerId, -claimed.price);
    await refundGold(sql, trainerId, claimed.price);
    await revertSaleClaim(sql, listingId, trainerId);
    throw err;
  }

  const trainer = await getTrainerById(sql, trainerId);
  return { listing: claimed, gold: trainer.gold };
}

// --- cancel --------------------------------------------------------------------

/**
 * Cancel one of the caller's own open listings, returning the escrowed good.
 * Claim-first (open -> cancelled, guarded on `seller_id = caller`) then
 * return the good; a failed return reverts the claim rather than leaving a
 * cancelled listing with nothing given back.
 * @param {{listingId:number}} body
 */
export async function cancelListing(sql, trainerId, body) {
  const listingId = Number(body?.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) throw httpError(400, "listingId must be a positive integer");

  const claimed = await claimCancelled(sql, listingId, trainerId);
  if (!claimed) throw httpError(409, "listing not open or not yours");

  try {
    await transferGood(sql, claimed, claimed.sellerId);
  } catch (err) {
    await revertCancelClaim(sql, listingId, trainerId);
    throw err;
  }

  return { listing: claimed, listings: await myListingsRepo(sql, trainerId) };
}

// --- shared transfer -----------------------------------------------------------

/**
 * Hand an escrowed good to `ownerId` — used identically by buy (transfer to
 * the buyer) and cancel (return to the seller), the only difference being
 * which trainer id is passed. Equipment resolves its home table via the
 * listing's denormalized `defId` (server/repos/inventory.js getEquipmentDomain)
 * rather than re-guessing across both tables.
 */
async function transferGood(sql, listing, ownerId) {
  if (listing.kind === "item") {
    await grantItemRepo(sql, ownerId, listing.defId, listing.qty);
    return;
  }
  if (listing.kind === "equipment") {
    const domain = await getEquipmentDomain(sql, listing.defId);
    const ok = domain === "trainer"
      ? await assignTrainerEquipmentOwner(sql, listing.refId, ownerId)
      : await assignMonsterEquipmentOwner(sql, listing.refId, ownerId);
    if (!ok) throw httpError(500, "escrowed equipment instance missing");
    return;
  }
  if (listing.kind === "rune") {
    const ok = await assignRuneOwner(sql, listing.refId, ownerId);
    if (!ok) throw httpError(500, "escrowed rune instance missing");
    return;
  }
  // monster
  const ok = await assignMonsterOwner(sql, listing.refId, ownerId);
  if (!ok) throw httpError(500, "escrowed monster instance missing");
}
