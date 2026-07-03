// Admin-console I/O boundary (Phase 5). Same contract as services/content.js:
// ui/admin.js never touches fetch() itself. Every mutation responds with a
// fresh masterState — the console re-renders what the server now holds, so
// the client never has to patch its own copy of master data.

async function request(path, method, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} failed: ${res.status}`);
  return data;
}

/** @typedef {{classes:object[], skills:object[], species:object[], jobs:object[],
 *   itemDefs:object[], equipmentDefs:object[], runeDefs:object[], enums:object}} MasterState */

/** @returns {Promise<MasterState>} everything the console renders, in one read. */
export const loadMaster = () => request("/api/admin/master", "GET");

export const saveClass = (row) => request("/api/admin/classes", "POST", row);
export const deleteClass = (cls) => request("/api/admin/classes", "DELETE", { cls });

export const saveSkill = (row) => request("/api/admin/skills", "POST", row);
export const deleteSkill = (id) => request("/api/admin/skills", "DELETE", { id });

export const saveSpecies = (row) => request("/api/admin/species", "POST", row);
export const deleteSpecies = (id) => request("/api/admin/species", "DELETE", { id });

export const saveJob = (row) => request("/api/admin/jobs", "POST", row);
export const deleteJob = (id) => request("/api/admin/jobs", "DELETE", { id });

export const saveItem = (row) => request("/api/admin/items", "POST", row);
export const deleteItem = (id) => request("/api/admin/items", "DELETE", { id });

export const saveEquipment = (row) => request("/api/admin/equipment", "POST", row);
export const deleteEquipment = (id) => request("/api/admin/equipment", "DELETE", { id });

export const saveRune = (row) => request("/api/admin/runes", "POST", row);
export const deleteRune = (id) => request("/api/admin/runes", "DELETE", { id });

/**
 * Grant an item/equipment piece/rune to a trainer (defaults to the calling
 * admin server-side when trainerId is omitted) — the only acquisition
 * source until Phase 7.4 (marketplace/summons).
 * @param {{trainerId?:number, kind:'item'|'equipment'|'rune', defId:string, qty?:number}} body
 * @returns {Promise<{trainer:object, inventory:object}>}
 */
export const grant = (body) => request("/api/admin/grant", "POST", body);
