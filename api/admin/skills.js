// POST   /api/admin/skills { id, name, slot, cooldown, data }  -> upsert a skill
//        (data is validated against the engine's closed op grammar)
// DELETE /api/admin/skills { id }  -> delete (409 while loadouts/monsters use it)
// Both respond with a fresh masterState. Admin only.

import { crudHandler } from "./_handler.js";
import { saveSkill, removeSkill } from "../../server/services/admin.js";

export default crudHandler(saveSkill, removeSkill);
