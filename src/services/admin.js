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

/** @typedef {{classes:object[], skills:object[], species:object[], jobs:object[], enums:object}} MasterState */

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
