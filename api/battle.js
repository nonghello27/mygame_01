// POST /api/battle
//   body: { playerOrder: number[], enemyOrder: number[] }
//   -> { youWin, survivor:{side,idx}|null, events:[...] }
//
// Resolves the ENTIRE battle on the server from authoritative DB stats and
// returns an event log for the client to replay. The client never computes the
// outcome, so it cannot fake or modify the result — the most it can do by
// tampering is lie to its own screen. The client only gets to choose the lane
// ORDER of each army (a permutation); the stats behind each lane come from the
// database here, so a hacked client cannot inflate atk/hp or add/drop units.

import { db, sendJson, readJson } from "./_db.js";
import { resolveBattle } from "../src/core/resolve.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });

    const { playerOrder, enemyOrder } = await readJson(req);

    // Authoritative roster: stats come from the DB, in lane (ord) order.
    const sql = db();
    const rows = await sql`
      SELECT army, name, cls, emoji, hp, atk, spd, sprite
      FROM units
      ORDER BY army, ord`;
    const A = [], B = [];
    for (const r of rows) {
      const arr = r.army === "A" ? A : B;
      arr.push({ idx: arr.length, name: r.name, cls: r.cls, hp: r.hp, atk: r.atk, spd: r.spd });
    }

    const rosterA = applyOrder(A, playerOrder);
    const rosterB = applyOrder(B, enemyOrder);

    sendJson(res, 200, resolveBattle(rosterA, rosterB));
  } catch (e) {
    sendJson(res, 400, { error: String(e?.message || e) });
  }
}

/**
 * Reorder a DB-ordered roster by a client-supplied permutation, rejecting
 * anything that is not a bijection over [0..n-1]. This is the validation that
 * stops a hacked client from duplicating a strong unit, dropping a weak one, or
 * smuggling in an out-of-range lane. Stats always come from `roster` (the DB).
 */
function applyOrder(roster, order) {
  const n = roster.length;
  if (!Array.isArray(order) || order.length !== n) {
    throw new Error(`order must be a permutation of ${n} lanes`);
  }
  const seen = new Set();
  const out = [];
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) {
      throw new Error(`illegal order: ${JSON.stringify(order)}`);
    }
    seen.add(i);
    out.push(roster[i]);
  }
  return out;
}
