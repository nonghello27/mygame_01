// One of 7 domain routers behind the 7 Vercel serverless functions
// (Hobby plan caps a deployment at 12; grouping by domain keeps room to
// grow). This table owns the `activities` domain's URLs — just one route
// today, so api/activities.js (a plain file, not a folder) calls route()
// directly; the Vite dev middleware does the same locally. That one route
// now carries three methods (GET/POST/DELETE, Phase 10.10) — cancel rides
// the bare path as DELETE rather than a new sub-path, since a plain file
// can't grow a folder's worth of URLs.

import { createRouter } from "../http.js";
import { activities } from "../routes/activities.js";

export const route = createRouter({
  "/api/activities": { GET: activities, POST: activities, DELETE: activities },
});
