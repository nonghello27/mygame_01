// One of 7 Vercel serverless functions (Hobby plan caps a deployment at 12;
// grouping by domain leaves room for ~2 more before hitting it). Owns every
// /api/admin/* URL. Real routing lives in server/routers/admin.js. In dev,
// Vite's middleware calls that router directly and this file isn't loaded.
// In production, vercel.json's rewrites fold any multi-segment /api/admin/*
// path back onto this same function so req.url still carries the original
// path.

import { route } from "../../server/routers/admin.js";

export default function handler(req, res) {
  return route(req, res);
}
