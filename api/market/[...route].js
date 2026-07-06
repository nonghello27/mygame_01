// The 7th of now-7 domain-grouped Vercel serverless functions (Hobby plan
// caps a deployment at 12; CLAUDE.md §5 sanctions the marketplace as the one
// reason to add a new top-level api/ entry — see server/routers/market.js).
// Owns every /api/market/* URL. Real routing lives in
// server/routers/market.js. In dev, Vite's middleware calls that router
// directly and this file isn't loaded.

import { route } from "../../server/routers/market.js";

export default function handler(req, res) {
  return route(req, res);
}
