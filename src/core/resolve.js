// Pure, deterministic battle resolution. NO DOM, NO timing, NO cutscene — so it
// is safe to run on the SERVER (Node) and is the single source of truth for who
// wins. Instead of animating, it RECORDS an ordered list of events; the client
// replays that list. Because the outcome is decided here (server-side, from
// authoritative stats), a tampered client can only fool its own screen.
//
// Rules mirror the old client loop exactly: damage is flat `atk`, higher `spd`
// strikes first in a duel, ties favor the player (side "a").

/** A live combat instance derived from a unit definition. */
function liveUnit(def, side) {
  return {
    side,
    idx: def.idx,        // stable lane identity shared with the client (not the DB serial)
    name: def.name,
    cls: def.cls,
    maxHp: def.hp,
    hp: def.hp,
    atk: def.atk,
    spd: def.spd,
    alive: true,
  };
}

const firstAlive = (arr) => arr.find((u) => u.alive) || null;
const aliveCount = (arr) => arr.reduce((n, u) => n + (u.alive ? 1 : 0), 0);

/**
 * Resolve a whole battle from two ordered rosters of unit DEFINITIONS.
 * @param {Array<{idx:number,name:string,cls:string,hp:number,atk:number,spd:number}>} rosterA player, lane 0 = front
 * @param {Array<...>} rosterB enemy, lane 0 = front
 * @returns {{ youWin:boolean, survivor:{side:string,idx:number}|null, events:object[] }}
 */
export function resolveBattle(rosterA, rosterB) {
  const A = rosterA.map((d) => liveUnit(d, "a"));
  const B = rosterB.map((d) => liveUnit(d, "b"));
  const events = [];

  while (aliveCount(A) && aliveCount(B)) {
    const a = firstAlive(A);
    const b = firstAlive(B);
    events.push({ t: "duel", a: ref(a), b: ref(b) });

    // Who strikes first stays fixed for the whole duel. Tie favors the player.
    const aFirst = a.spd >= b.spd;
    while (a.alive && b.alive && a.hp > 0 && b.hp > 0) {
      const first = aFirst ? a : b;
      const second = aFirst ? b : a;

      strike(first, second, events);
      if (second.hp <= 0) { fall(second, events); break; }
      strike(second, first, events);
      if (first.hp <= 0) { fall(first, events); break; }
    }
  }

  const youWin = aliveCount(A) > 0;
  const survivor = firstAlive(youWin ? A : B);
  return { youWin, survivor: survivor ? ref(survivor) : null, events };
}

/** A unit's wire identity: which side + which original lane index. */
const ref = (u) => ({ side: u.side, idx: u.idx });

/** One unit hits another. Records the damage so the client can replay it. */
function strike(att, def, events) {
  const dmg = att.atk;
  const before = def.hp;
  const after = Math.max(0, def.hp - dmg);
  def.hp = after;
  events.push({ t: "strike", att: ref(att), def: ref(def), dmg, before, after });
}

/** Mark a unit defeated. */
function fall(unit, events) {
  unit.alive = false;
  events.push({ t: "fall", side: unit.side, idx: unit.idx });
}
