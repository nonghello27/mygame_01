// One of 5 domain routers behind the 5 Vercel serverless functions
// (Hobby plan caps a deployment at 12; grouping by domain keeps room to
// grow). This table owns the `activities` domain's URLs — just one route
// today, so api/activities.js (a plain file, not a folder) calls route()
// directly; the Vite dev middleware does the same locally.

import { createRouter } from "../http.js";
import { activities } from "../routes/activities.js";

export const route = createRouter({
  "/api/activities": { GET: activities, POST: activities },
});
