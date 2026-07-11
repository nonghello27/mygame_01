// The 8th of now-8 domain-grouped Vercel serverless functions (Hobby plan
// caps a deployment at 12; CLAUDE.md §5 sanctions guilds as the second
// reason to add a new top-level api/ entry, after the marketplace — see
// server/routers/guild.js). Owns every /api/guild/* URL. Real routing lives
// in server/routers/guild.js. In dev, Vite's middleware calls that router
// directly and this file isn't loaded. In production, vercel.json's
// rewrites fold any multi-segment /api/guild/* path back onto this same
// function so req.url still carries the original path.

import { route } from "../../server/routers/guild.js";

export default function handler(req, res) {
  return route(req, res);
}
