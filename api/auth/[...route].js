// One of 6 Vercel serverless functions (Hobby plan caps a deployment at 12;
// grouping by domain leaves room for ~3 more before hitting it). Owns every
// /api/auth/* URL. Real routing lives in server/routers/auth.js. In dev,
// Vite's middleware calls that router directly and this file isn't loaded.

import { route } from "../../server/routers/auth.js";

export default function handler(req, res) {
  return route(req, res);
}
