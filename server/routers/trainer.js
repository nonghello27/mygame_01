// One of 5 domain routers behind the 5 Vercel serverless functions
// (Hobby plan caps a deployment at 12; grouping by domain keeps room to
// grow). This table owns the `trainer` domain's URLs;
// api/trainer/[...route].js (prod) and vite.config.js's dev middleware
// (local) both just call route().
//
// URLs renamed from the old single-function router to avoid the domain
// prefix colliding with an endpoint name: /api/me -> /api/trainer/me,
// /api/classes -> /api/trainer/classes, /api/progression ->
// /api/trainer/progression, /api/trainer-skills -> /api/trainer/skills.
//
// /api/trainer/inventory (Phase 7.1) follows the same precedent: the
// ROADMAP draft wrote plain /api/inventory, but a new top-level api/ file
// would cost another Vercel function, so it's grouped under this domain.

import { createRouter } from "../http.js";
import { me } from "../routes/me.js";
import { classes } from "../routes/classes.js";
import { progression } from "../routes/progression.js";
import { trainerSkills } from "../routes/trainerSkills.js";
import { inventory } from "../routes/inventory.js";

export const route = createRouter({
  "/api/trainer/me": { GET: me },
  "/api/trainer/classes": { GET: classes },
  "/api/trainer/progression": { GET: progression, POST: progression },
  "/api/trainer/skills": { POST: trainerSkills },
  "/api/trainer/inventory": { GET: inventory },
});
