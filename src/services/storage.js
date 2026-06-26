// Player/progress persistence boundary. localStorage today; swap the two bodies
// for a DB/auth-backed call later without touching callers. SCHEMA is versioned
// so saved blobs can be migrated when the shape changes — never persist raw
// state without a version tag.

const KEY = "battle-line:player";
const SCHEMA = 1;

/**
 * Persist a player/progress blob. Wraps it with a schema version.
 * @param {object} data
 */
export async function savePlayer(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ schema: SCHEMA, data }));
  } catch (e) {
    console.warn("savePlayer failed:", e);
  }
}

/**
 * Load the player/progress blob, or null if none/incompatible.
 * @returns {Promise<object|null>}
 */
export async function loadPlayer() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.schema !== SCHEMA) return null; // migrate here when SCHEMA bumps
    return parsed.data;
  } catch {
    return null;
  }
}
