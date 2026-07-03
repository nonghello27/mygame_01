// One of 5 Vercel serverless functions (Hobby plan caps a deployment at 12;
// grouping by domain leaves room for ~4 more before hitting it). A plain
// file (not a folder) since `activities` owns only one URL today. Real
// routing lives in server/routers/activities.js. In dev, Vite's middleware
// calls that router directly and this file isn't loaded.

import { route } from "../server/routers/activities.js";

export default function handler(req, res) {
  return route(req, res);
}
