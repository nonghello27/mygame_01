// The 7th domain-grouped Vercel serverless function (Hobby plan caps a
// deployment at 12 — this is the one sanctioned reason from CLAUDE.md §5 to
// add a new top-level api/ entry: the marketplace's transactional care
// doesn't fit inside an existing domain). Owns every /api/market/* URL —
// browse/mine/list/buy/cancel for Phase 8. api/market/[...route].js (prod)
// and vite.config.js's dev middleware (local) both just call route().
//
// Browse lives at /api/market/browse, not the bare /api/market — a Vercel
// catch-all `[...route].js` never matches its own bare prefix (same reason
// api/activities.js stays a plain top-level file for its one bare route,
// CLAUDE.md's api/ layout note), so every URL under this domain needs at
// least one path segment after /api/market.

import { createRouter } from "../http.js";
import { browse, mine, list, buy, cancel } from "../routes/market.js";

export const route = createRouter({
  "/api/market/browse": { GET: browse },
  "/api/market/mine": { GET: mine },
  "/api/market/list": { POST: list },
  "/api/market/buy": { POST: buy },
  "/api/market/cancel": { POST: cancel },
});
