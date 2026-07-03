// One of 5 domain routers behind the 5 Vercel serverless functions
// (Hobby plan caps a deployment at 12; grouping by domain keeps room to
// grow). This table owns the `admin` domain's URLs; api/admin/[...route].js
// (prod) and vite.config.js's dev middleware (local) both just call route().

import { createRouter } from "../http.js";
import * as admin from "../routes/admin.js";

export const route = createRouter({
  "/api/admin/master": { GET: admin.master },
  "/api/admin/classes": { POST: admin.classes, DELETE: admin.classes },
  "/api/admin/skills": { POST: admin.skills, DELETE: admin.skills },
  "/api/admin/species": { POST: admin.species, DELETE: admin.species },
  "/api/admin/jobs": { POST: admin.jobs, DELETE: admin.jobs },
  "/api/admin/items": { POST: admin.items, DELETE: admin.items },
  "/api/admin/equipment": { POST: admin.equipment, DELETE: admin.equipment },
  "/api/admin/runes": { POST: admin.runes, DELETE: admin.runes },
  "/api/admin/grant": { POST: admin.grant },
});
