// POST   /api/admin/classes { cls, attackName, fx }  -> upsert a class
// DELETE /api/admin/classes { cls }                  -> delete (409 if species use it)
// Both respond with a fresh masterState. Admin only.

import { crudHandler } from "./_handler.js";
import { saveClass, removeClass } from "../../server/services/admin.js";

export default crudHandler(saveClass, removeClass, "cls");
