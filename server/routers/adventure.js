// The 6th of now-7 domain-grouped Vercel serverless functions (Hobby plan
// caps a deployment at 12 — this is the "genuinely new domain" case from
// CLAUDE.md §5, anticipated by docs/ARCHITECTURE.md's "not yet built" list:
// `POST /api/adventure/*`). Owns every /api/adventure/* URL — session
// create/step for Phase 7.4 step B's Adventure. api/adventure/[...route].js
// (prod) and vite.config.js's dev middleware (local) both just call route().

import { createRouter } from "../http.js";
import { state, start, move, battle, surrender, exit, abandon } from "../routes/adventure.js";

export const route = createRouter({
  "/api/adventure/state": { GET: state },
  "/api/adventure/start": { POST: start },
  "/api/adventure/move": { POST: move },
  "/api/adventure/battle": { POST: battle },
  "/api/adventure/surrender": { POST: surrender },
  "/api/adventure/exit": { POST: exit },
  "/api/adventure/abandon": { POST: abandon },
});
