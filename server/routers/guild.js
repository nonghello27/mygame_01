// The 8th domain-grouped Vercel serverless function (Hobby plan caps a
// deployment at 12 — CLAUDE.md §5 sanctions guilds as the second reason,
// after the marketplace, to add a new top-level api/ entry: the application/
// role-check flow doesn't belong under any existing domain). Owns every
// /api/guild/* URL — browse/me/create/apply/accept/reject/leave/kick/
// promote/transfer for Phase 9.4, plus (Phase 9.5) GVG events/submit/
// withdraw/lineup/register, and (Phase 9.7) GVG detail — the war bracket +
// standings view. api/guild/[...route].js (prod) and vite.config.js's dev
// middleware (local) both just call route().
//
// Every URL here needs at least one path segment after /api/guild — a
// Vercel catch-all `[...route].js` never matches its own bare prefix (same
// reason api/activities.js stays a plain top-level file for its one bare
// route, and server/routers/market.js's browse lives at /api/market/browse).

import { createRouter } from "../http.js";
import {
  browse, me, create, apply, accept, reject, leave, kick, promote, transfer,
} from "../routes/guild.js";
import {
  gvgEvents, gvgSubmit, gvgWithdraw, gvgLineup, gvgRegister, gvgDetail,
} from "../routes/gvg.js";

export const route = createRouter({
  "/api/guild/browse": { GET: browse },
  "/api/guild/me": { GET: me },
  "/api/guild/create": { POST: create },
  "/api/guild/apply": { POST: apply },
  "/api/guild/accept": { POST: accept },
  "/api/guild/reject": { POST: reject },
  "/api/guild/leave": { POST: leave },
  "/api/guild/kick": { POST: kick },
  "/api/guild/promote": { POST: promote },
  "/api/guild/transfer": { POST: transfer },
  // Phase 9.5 — GVG events ride the guild domain (no new serverless function).
  "/api/guild/gvg/events": { GET: gvgEvents },
  "/api/guild/gvg/submit": { POST: gvgSubmit },
  "/api/guild/gvg/withdraw": { POST: gvgWithdraw },
  "/api/guild/gvg/lineup": { POST: gvgLineup },
  "/api/guild/gvg/register": { POST: gvgRegister },
  "/api/guild/gvg/detail": { GET: gvgDetail },
});
