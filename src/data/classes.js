// Metadata for each unit class. The class name is the single source key that
// links a unit's stats (data/units.js), its portrait (cutscene/portraits.js),
// its attack effect (cutscene/effects.js), and its class-icon art
// (public/icons/classes/, via `icon` below).
//
// This module is now SEED data only (Phase 10.12 follow-up): `attackName`/
// `fx`/`icon` load into the `classes` master table's own columns via
// `npm run db:seed` (db/seed.mjs), and the LIVE source of truth from then
// on is that table — edit any class's icon live in the admin console's 🎭
// Classes tab (with an image preview) rather than here; db:seed overwrites
// same-id rows, so an edit made only here is lost on the next seed.
//
// To ADD A NEW CLASS:
//   1. Add an entry here (attackName + fx + icon) — or use the admin
//      console's "＋ New class" form for a class meant to stay DB-only.
//   2. Add a portrait case in cutscene/portraits.js (keyed by class name).
//   3. Add an effect case in cutscene/effects.js (keyed by the `fx` value).
//   4. Drop public/icons/classes/<icon>.png (64x64, transparent) and set
//      `icon` to its base filename (no extension). A class whose `icon`
//      column is empty falls back to its own name lowercased, then to
//      default.png — see that folder's README.
//   5. Add units that use it in data/units.js.

export const CLASS_META = {
  Knight:   { attackName: "Blade Arc",       fx: "slash",  icon: "knight" },
  Archer:   { attackName: "Piercing Volley", fx: "arrows", icon: "archer" },
  Lancer:   { attackName: "Lance Drive",     fx: "lance",  icon: "lancer" },
  Raider:   { attackName: "Savage Cleave",   fx: "cleave", icon: "raider" },
  Shaman:   { attackName: "Hex Bolt",        fx: "magic",  icon: "shaman" },
  Warbeast: { attackName: "Tusk Charge",     fx: "charge", icon: "warbeast" },
};
