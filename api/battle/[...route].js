// One of 7 Vercel serverless functions (Hobby plan caps a deployment at 12;
// grouping by domain leaves room for ~2 more before hitting it). Owns every
// /api/battle/* URL. Real routing lives in server/routers/battle.js. In dev,
// Vite's middleware calls that router directly and this file isn't loaded.

import { route } from "../../server/routers/battle.js";

export default function handler(req, res) {
  return route(req, res);
}
