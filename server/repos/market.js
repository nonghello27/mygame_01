// SQL for the marketplace (Phase 8): `marketplace_listings` CRUD/claims, plus
// the per-kind escrow/return operations a listing's `kind` dispatches through
// (item stacks, equipment instances in either domain table, rune instances,
// monster instances). Same "guarded statement is the whole claim" shape as
// every other claim-first-then-pay flow in this codebase (equipment's
// enhance, runes' repair, summon's pay legs) — see db/migrations/013_marketplace.sql's
// header for the full escrow rationale.
//
// Equipment is the one kind with two possible home tables (trainer_equipment
// vs monster_equipment, picked by the def's `domain`) — getOwnedEquipmentInstance
// is a READ-ONLY precheck used only at list() time to learn which table AND
// the def id (a fresh listing's caller sends nothing but `refId`); after that,
// the def id is denormalized onto the listing row itself, so every LATER
// operation (buy's transfer, cancel's return) resolves the domain via
// getEquipmentDomain(defId) (server/repos/inventory.js) instead of guessing
// across both tables again.

function shapeListing(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    sellerId: Number(r.seller_id),
    kind: r.kind,
    defId: r.def_id,
    refId: r.ref_id === null || r.ref_id === undefined ? null : Number(r.ref_id),
    qty: r.qty,
    price: r.price,
    status: r.status,
    buyerId: r.buyer_id === null || r.buyer_id === undefined ? null : Number(r.buyer_id),
    createdAt: r.created_at,
    closedAt: r.closed_at ?? null,
  };
}

// --- listing row CRUD/claims -------------------------------------------------

/** Create the escrow-backed listing row. Kind-specific escrow already
 *  happened before this is called; a failure HERE is what the caller's
 *  compensation (reversing that escrow) exists for. */
export async function insertListing(sql, { sellerId, kind, defId, refId, qty, price }) {
  const rows = await sql`
    INSERT INTO marketplace_listings (seller_id, kind, def_id, ref_id, qty, price)
    VALUES (${sellerId}, ${kind}, ${defId}, ${refId}, ${qty}, ${price})
    RETURNING id, seller_id, kind, def_id, ref_id, qty, price, status, buyer_id, created_at, closed_at`;
  return shapeListing(rows[0]);
}

export async function getListingById(sql, listingId) {
  const rows = await sql`
    SELECT id, seller_id, kind, def_id, ref_id, qty, price, status, buyer_id, created_at, closed_at
    FROM marketplace_listings WHERE id = ${listingId}`;
  return shapeListing(rows[0]);
}

/**
 * The buy claim: open -> sold, in one statement. `seller_id <> buyer` is
 * folded into the WHERE (not just pre-checked) so a self-purchase can never
 * win the claim even under a race with a status change. No row back means
 * either it was never open, already got claimed by someone else, or the
 * caller is the seller — the service's earlier read already told those apart
 * for the error message; a lost claim here is always "already sold or
 * cancelled" (or a self-purchase that slipped past the pre-check).
 */
export async function claimSold(sql, listingId, buyerId) {
  const rows = await sql`
    UPDATE marketplace_listings
    SET status = 'sold', buyer_id = ${buyerId}, closed_at = now()
    WHERE id = ${listingId} AND status = 'open' AND seller_id <> ${buyerId}
    RETURNING id, seller_id, kind, def_id, ref_id, qty, price, status, buyer_id, created_at, closed_at`;
  return shapeListing(rows[0]);
}

/** Compensation only: undo a won buy claim when a later leg (debit/credit/
 *  transfer) fails, so the listing goes back on sale rather than vanishing
 *  sold-but-undelivered. Guarded on `buyer_id = this buyer` so it can only
 *  undo the exact claim this call just won. */
export async function revertSaleClaim(sql, listingId, buyerId) {
  const rows = await sql`
    UPDATE marketplace_listings
    SET status = 'open', buyer_id = NULL, closed_at = NULL
    WHERE id = ${listingId} AND status = 'sold' AND buyer_id = ${buyerId}
    RETURNING id`;
  return rows.length > 0;
}

/** The cancel claim: open -> cancelled, guarded on `seller_id = caller`. */
export async function claimCancelled(sql, listingId, sellerId) {
  const rows = await sql`
    UPDATE marketplace_listings
    SET status = 'cancelled', closed_at = now()
    WHERE id = ${listingId} AND status = 'open' AND seller_id = ${sellerId}
    RETURNING id, seller_id, kind, def_id, ref_id, qty, price, status, buyer_id, created_at, closed_at`;
  return shapeListing(rows[0]);
}

/** Compensation only: undo a won cancel claim when returning the escrowed
 *  good fails, so the listing stays live rather than vanishing cancelled-
 *  with-nothing-returned. */
export async function revertCancelClaim(sql, listingId, sellerId) {
  const rows = await sql`
    UPDATE marketplace_listings
    SET status = 'open', closed_at = NULL
    WHERE id = ${listingId} AND status = 'cancelled' AND seller_id = ${sellerId}
    RETURNING id`;
  return rows.length > 0;
}

// --- browse / mine ------------------------------------------------------------

/**
 * Open listings only, newest first, with search/filter + paging applied in
 * SQL. Only the base row + seller name + a name usable for `q` search come
 * back from this query (one LEFT JOIN per kind, only one of which is
 * non-null per row since `kind` gates each join) — enrichListings() below
 * fills in the rest per kind in a small, separate batch of queries.
 */
export async function browseListingsRepo(sql, { kind, q, minPrice, maxPrice, limit, offset }) {
  const rows = await sql`
    SELECT l.id, l.seller_id, l.kind, l.def_id, l.ref_id, l.qty, l.price, l.created_at,
      t.name AS seller_name
    FROM marketplace_listings l
    JOIN trainers t ON t.id = l.seller_id
    LEFT JOIN item_defs i ON l.kind = 'item' AND i.id = l.def_id
    LEFT JOIN equipment_defs e ON l.kind = 'equipment' AND e.id = l.def_id
    LEFT JOIN rune_defs r ON l.kind = 'rune' AND r.id = l.def_id
    LEFT JOIN monster_species s ON l.kind = 'monster' AND s.id = l.def_id
    WHERE l.status = 'open'
      AND (${kind}::text IS NULL OR l.kind = ${kind})
      AND (${q}::text IS NULL OR COALESCE(i.name, e.name, r.name, s.name) ILIKE ${q})
      AND (${minPrice}::int IS NULL OR l.price >= ${minPrice})
      AND (${maxPrice}::int IS NULL OR l.price <= ${maxPrice})
    ORDER BY l.created_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return enrichListings(sql, rows, { mine: false });
}

/** Every listing this trainer has ever created, any status, newest first —
 *  same enrichment as browse, plus buyer name / closed-at for sold rows. */
export async function myListingsRepo(sql, trainerId) {
  const rows = await sql`
    SELECT l.id, l.seller_id, l.kind, l.def_id, l.ref_id, l.qty, l.price, l.status,
      l.buyer_id, l.created_at, l.closed_at,
      t.name AS seller_name, b.name AS buyer_name
    FROM marketplace_listings l
    JOIN trainers t ON t.id = l.seller_id
    LEFT JOIN trainers b ON b.id = l.buyer_id
    WHERE l.seller_id = ${trainerId}
    ORDER BY l.created_at DESC`;
  return enrichListings(sql, rows, { mine: true });
}

/**
 * Batch-fetch each kind's display detail (name/description/effects/instance
 * state) for a page of listing rows, then map every row into its final
 * display shape. One query per kind actually present on the page (never four
 * unconditionally) — small, readable, and avoids a four-way OUTER JOIN across
 * every possible instance table for every row.
 */
async function enrichListings(sql, rows, { mine }) {
  if (rows.length === 0) return [];

  const itemDefIds = [...new Set(rows.filter((r) => r.kind === "item").map((r) => r.def_id))];
  const equipRefIds = rows.filter((r) => r.kind === "equipment").map((r) => Number(r.ref_id));
  const runeRefIds = rows.filter((r) => r.kind === "rune").map((r) => Number(r.ref_id));
  const monsterRefIds = rows.filter((r) => r.kind === "monster").map((r) => Number(r.ref_id));

  const [items, trainerEquip, monsterEquip, runes, monsters] = await Promise.all([
    itemDefIds.length
      ? sql`SELECT id, name, description, kind, icon FROM item_defs WHERE id = ANY(${itemDefIds}::text[])`
      : Promise.resolve([]),
    equipRefIds.length
      ? sql`
          SELECT e.id, d.id AS def_id, d.name, d.slot, d.domain, d.icon, d.effects, e.enhance_level
          FROM trainer_equipment e JOIN equipment_defs d ON d.id = e.def_id
          WHERE e.id = ANY(${equipRefIds}::bigint[])`
      : Promise.resolve([]),
    equipRefIds.length
      ? sql`
          SELECT m.id, d.id AS def_id, d.name, d.slot, d.domain, d.icon, d.effects, m.enhance_level
          FROM monster_equipment m JOIN equipment_defs d ON d.id = m.def_id
          WHERE m.id = ANY(${equipRefIds}::bigint[])`
      : Promise.resolve([]),
    runeRefIds.length
      ? sql`
          SELECT r.id, d.id AS def_id, d.name, d.icon, d.effects, d.max_charges, r.charges_left, r.broken, r.level
          FROM runes r JOIN rune_defs d ON d.id = r.def_id
          WHERE r.id = ANY(${runeRefIds}::bigint[])`
      : Promise.resolve([]),
    monsterRefIds.length
      ? sql`
          SELECT mo.id, mo.nickname, mo.hp, mo.atk, mo.spd, mo.str, mo.agi, mo.vit, mo.intl, mo.dex,
            s.id AS species_id, s.name AS species_name, s.emoji, s.sprite, s.element
          FROM monsters mo JOIN monster_species s ON s.id = mo.species_id
          WHERE mo.id = ANY(${monsterRefIds}::bigint[])`
      : Promise.resolve([]),
  ]);

  const itemById = new Map(items.map((r) => [r.id, r]));
  const equipById = new Map([...trainerEquip, ...monsterEquip].map((r) => [Number(r.id), r]));
  const runeById = new Map(runes.map((r) => [Number(r.id), r]));
  const monsterById = new Map(monsters.map((r) => [Number(r.id), r]));

  return rows.map((r) => {
    const out = {
      id: Number(r.id),
      kind: r.kind,
      price: r.price,
      qty: r.qty,
      sellerName: r.seller_name,
      createdAt: r.created_at,
    };
    if (mine) {
      out.status = r.status;
      out.buyerName = r.buyer_name ?? null;
      out.closedAt = r.closed_at ?? null;
    }

    if (r.kind === "item") {
      const d = itemById.get(r.def_id);
      out.good = d ? { name: d.name, description: d.description, kind: d.kind, icon: d.icon, defId: d.id } : null;
    } else if (r.kind === "equipment") {
      const d = equipById.get(Number(r.ref_id));
      out.good = d
        ? { name: d.name, slot: d.slot, domain: d.domain, icon: d.icon, effects: d.effects,
            enhanceLevel: d.enhance_level, defId: d.def_id }
        : null;
    } else if (r.kind === "rune") {
      const d = runeById.get(Number(r.ref_id));
      out.good = d
        ? {
            name: d.name, icon: d.icon, effects: d.effects, maxCharges: d.max_charges,
            chargesLeft: d.charges_left, broken: d.broken, level: d.level, defId: d.def_id,
          }
        : null;
    } else {
      // monster
      const d = monsterById.get(Number(r.ref_id));
      out.good = d
        ? {
            name: d.nickname ?? d.species_name, speciesId: d.species_id, emoji: d.emoji, sprite: d.sprite,
            element: d.element,
            attrs: { str: d.str, agi: d.agi, vit: d.vit, int: d.intl, dex: d.dex },
            base: { hp: d.hp, atk: d.atk, spd: d.spd },
          }
        : null;
    }
    return out;
  });
}

// --- equipment escrow/return --------------------------------------------------

/** Read-only precheck (list() time only): which table (domain) owns this
 *  refId, and its def id — a fresh listing only carries `refId`, so this is
 *  how the service learns which guarded escrow statement to run. Never used
 *  as a gate itself; the escrow* functions below are the actual claim. */
export async function getOwnedEquipmentInstance(sql, trainerId, refId) {
  const t = await sql`
    SELECT e.id, e.def_id, e.enhance_level, e.equipped_slot, d.domain
    FROM trainer_equipment e JOIN equipment_defs d ON d.id = e.def_id
    WHERE e.id = ${refId} AND e.trainer_id = ${trainerId}`;
  if (t[0]) {
    return {
      id: Number(t[0].id), defId: t[0].def_id, enhanceLevel: t[0].enhance_level,
      domain: "trainer", unequipped: t[0].equipped_slot === null,
    };
  }
  const m = await sql`
    SELECT m.id, m.def_id, m.enhance_level, m.monster_id, d.domain
    FROM monster_equipment m JOIN equipment_defs d ON d.id = m.def_id
    WHERE m.id = ${refId} AND m.trainer_id = ${trainerId}`;
  if (m[0]) {
    return {
      id: Number(m[0].id), defId: m[0].def_id, enhanceLevel: m[0].enhance_level,
      domain: "monster", unequipped: m[0].monster_id === null,
    };
  }
  return null;
}

/** Guarded escrow: trainer-domain equipment must be unequipped. */
export async function escrowTrainerEquipment(sql, trainerId, refId) {
  const rows = await sql`
    UPDATE trainer_equipment SET trainer_id = NULL
    WHERE id = ${refId} AND trainer_id = ${trainerId} AND equipped_slot IS NULL
    RETURNING id, def_id, enhance_level`;
  return rows[0] || null;
}

/** Guarded escrow: monster-domain equipment must be unequipped. */
export async function escrowMonsterEquipment(sql, trainerId, refId) {
  const rows = await sql`
    UPDATE monster_equipment SET trainer_id = NULL
    WHERE id = ${refId} AND trainer_id = ${trainerId} AND monster_id IS NULL
    RETURNING id, def_id, enhance_level`;
  return rows[0] || null;
}

/** Assign an ESCROWED (trainer_id IS NULL) trainer-domain piece to an owner —
 *  used for both cancel's "return to seller" and buy's "transfer to buyer",
 *  same guarded shape, just a different destination trainerId. */
export async function assignTrainerEquipmentOwner(sql, refId, trainerId) {
  const rows = await sql`
    UPDATE trainer_equipment SET trainer_id = ${trainerId}
    WHERE id = ${refId} AND trainer_id IS NULL
    RETURNING id`;
  return rows.length > 0;
}

/** Same as assignTrainerEquipmentOwner, against monster_equipment. */
export async function assignMonsterEquipmentOwner(sql, refId, trainerId) {
  const rows = await sql`
    UPDATE monster_equipment SET trainer_id = ${trainerId}
    WHERE id = ${refId} AND trainer_id IS NULL
    RETURNING id`;
  return rows.length > 0;
}

// --- rune escrow/return --------------------------------------------------------

export async function getOwnedRuneInstance(sql, trainerId, refId) {
  const rows = await sql`
    SELECT id, def_id, level, charges_left, broken, monster_id
    FROM runes WHERE id = ${refId} AND trainer_id = ${trainerId}`;
  return rows[0] || null;
}

/** Guarded escrow: rune must be unsocketed. Broken runes ARE listable — no
 *  `broken` check here, only `monster_id IS NULL` (a broken rune is always
 *  auto-unsocketed anyway, per Phase 7.3's durability settlement). */
export async function escrowRune(sql, trainerId, refId) {
  const rows = await sql`
    UPDATE runes SET trainer_id = NULL
    WHERE id = ${refId} AND trainer_id = ${trainerId} AND monster_id IS NULL
    RETURNING id, def_id, level, charges_left, broken`;
  return rows[0] || null;
}

/** Assign an ESCROWED (trainer_id IS NULL) rune to an owner — cancel's return
 *  or buy's transfer, same guarded shape. */
export async function assignRuneOwner(sql, refId, trainerId) {
  const rows = await sql`
    UPDATE runes SET trainer_id = ${trainerId}
    WHERE id = ${refId} AND trainer_id IS NULL
    RETURNING id`;
  return rows.length > 0;
}

// --- monster escrow/return -----------------------------------------------------

/**
 * Diagnostics only (never a gate): read every obligation a monster listing
 * must be free of, so the service can name exactly what blocks it (same
 * guarded-delete spirit as the admin detach route's diagnostic). The actual
 * gate is escrowMonster()'s single guarded UPDATE below.
 */
export async function getMonsterListingBlockers(sql, monsterId) {
  const rows = await sql`
    SELECT m.trainer_id, m.species_id, m.busy_until, m.busy_kind,
      EXISTS (SELECT 1 FROM formation_slots fs WHERE fs.monster_id = m.id) AS in_formation,
      EXISTS (SELECT 1 FROM monster_equipment me WHERE me.monster_id = m.id) AS has_equipment,
      EXISTS (SELECT 1 FROM runes r WHERE r.monster_id = m.id) AS has_runes
    FROM monsters m WHERE m.id = ${monsterId}`;
  return rows[0] || null;
}

/**
 * The one guarded UPDATE that is the real gate: right owner, not busy, not in
 * any defense formation, no equipped gear, no socketed runes — all evaluated
 * atomically so a race (e.g. equipping a piece between the precheck and this
 * call) can't sneak an obligated monster into escrow. Returns species_id (the
 * listing's denormalized def_id).
 */
export async function escrowMonster(sql, trainerId, monsterId) {
  const rows = await sql`
    UPDATE monsters SET trainer_id = NULL
    WHERE id = ${monsterId} AND trainer_id = ${trainerId}
      AND (busy_until IS NULL OR busy_until <= now())
      AND NOT EXISTS (SELECT 1 FROM formation_slots fs WHERE fs.monster_id = monsters.id)
      AND NOT EXISTS (SELECT 1 FROM monster_equipment me WHERE me.monster_id = monsters.id)
      AND NOT EXISTS (SELECT 1 FROM runes r WHERE r.monster_id = monsters.id)
    RETURNING id, species_id`;
  return rows[0] || null;
}

/** Assign an ESCROWED (trainer_id IS NULL) monster to an owner — cancel's
 *  return or buy's transfer, same guarded shape as the equipment/rune pair. */
export async function assignMonsterOwner(sql, monsterId, trainerId) {
  const rows = await sql`
    UPDATE monsters SET trainer_id = ${trainerId}
    WHERE id = ${monsterId} AND trainer_id IS NULL
    RETURNING id`;
  return rows.length > 0;
}
