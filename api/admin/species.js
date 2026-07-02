// POST   /api/admin/species { id, name, cls, emoji, sprite, starter, element,
//                             attackKind, attackStyle, targeting, base, attrs,
//                             skills:[p1,p2,normal,ult] }  -> upsert species + loadout
//        (class must exist; each loadout entry must be a skill of the slot's type)
// DELETE /api/admin/species { id }  -> delete (409 while owned monsters exist)
// Both respond with a fresh masterState. Admin only.

import { crudHandler } from "./_handler.js";
import { saveSpecies, removeSpecies } from "../../server/services/admin.js";

export default crudHandler(saveSpecies, removeSpecies);
