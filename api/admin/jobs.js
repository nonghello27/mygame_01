// POST   /api/admin/jobs { id, kind, name, durationS, rewards }  -> upsert a job
//        (work: rewards {gold, trainerExp} | training: rewards {attr, gain})
// DELETE /api/admin/jobs { id }  -> delete (409 while activities reference it)
// Both respond with a fresh masterState. Admin only.

import { crudHandler } from "./_handler.js";
import { saveJob, removeJob } from "../../server/services/admin.js";

export default crudHandler(saveJob, removeJob);
