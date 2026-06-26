// GET /api/rosters -> { armyA: UnitDef[], armyB: UnitDef[] }
// Same shape services/content.js#loadRosters used to return from data/units.js.

import { db, sendJson } from "./_db.js";

export default async function handler(req, res) {
  try {
    const sql = db();
    const rows = await sql`
      SELECT army, name, cls, emoji, hp, atk, spd, sprite
      FROM units
      ORDER BY army, ord`;

    const armyA = [];
    const armyB = [];
    for (const r of rows) {
      const def = {
        name: r.name, cls: r.cls, emoji: r.emoji,
        hp: r.hp, atk: r.atk, spd: r.spd,
      };
      if (r.sprite) def.sprite = r.sprite; // keep it optional, like data/units.js
      (r.army === "A" ? armyA : armyB).push(def);
    }
    sendJson(res, 200, { armyA, armyB });
  } catch (e) {
    sendJson(res, 500, { error: String(e?.message || e) });
  }
}
