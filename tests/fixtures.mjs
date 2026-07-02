// Fixture rosters shared by the golden tests (resolve.test.mjs) and the
// golden-file regenerator (golden/regen.mjs). Key = golden file name.

export const BATTLES = {
  "battle-1v1": {
    // Faster enemy strikes first each exchange and wins the race to 0 HP.
    rosterA: [{ idx: 0, name: "A0", cls: "Knight", hp: 30, atk: 10, spd: 5 }],
    rosterB: [{ idx: 0, name: "B0", cls: "Archer", hp: 25, atk: 12, spd: 7 }],
  },
  "battle-2v2": {
    // Covers: speed tie favoring the player, the survivor advancing with its
    // remaining HP, and a mid-battle lane change on each side.
    rosterA: [
      { idx: 0, name: "A0", cls: "Knight", hp: 20, atk: 5, spd: 5 },
      { idx: 1, name: "A1", cls: "Lancer", hp: 30, atk: 10, spd: 4 },
    ],
    rosterB: [
      { idx: 0, name: "B0", cls: "Knight", hp: 10, atk: 5, spd: 5 },
      { idx: 1, name: "B1", cls: "Archer", hp: 40, atk: 6, spd: 9 },
    ],
  },
};
