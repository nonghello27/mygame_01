// Metadata for each unit class. The class name is the single source key that
// links a unit's stats (data/units.js), its portrait (cutscene/portraits.js),
// and its attack effect (cutscene/effects.js).
//
// To ADD A NEW CLASS:
//   1. Add an entry here (attackName + fx).
//   2. Add a portrait case in cutscene/portraits.js (keyed by class name).
//   3. Add an effect case in cutscene/effects.js (keyed by the `fx` value).
//   4. Add units that use it in data/units.js.

export const CLASS_META = {
  Knight:   { attackName: "Blade Arc",       fx: "slash" },
  Archer:   { attackName: "Piercing Volley", fx: "arrows" },
  Lancer:   { attackName: "Lance Drive",     fx: "lance" },
  Raider:   { attackName: "Savage Cleave",   fx: "cleave" },
  Shaman:   { attackName: "Hex Bolt",        fx: "magic" },
  Warbeast: { attackName: "Tusk Charge",     fx: "charge" },
};
