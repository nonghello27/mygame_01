// One of 7 domain routers behind the 7 Vercel serverless functions
// (Hobby plan caps a deployment at 12; grouping by domain keeps room to
// grow). This table owns the `battle` domain's URLs; api/battle/[...route].js
// (prod) and vite.config.js's dev middleware (local) both just call route().
//
// URLs renamed from the old single-function router to avoid the domain
// prefix colliding with an endpoint name: /api/match -> /api/battle/match,
// /api/battle -> /api/battle/resolve.

import { createRouter } from "../http.js";
import { match } from "../routes/match.js";
import { battle } from "../routes/battle.js";
import { ladder } from "../routes/ladder.js";
import { formation } from "../routes/formation.js";
import { tournaments, tournamentRegister, tournamentWithdraw } from "../routes/tournament.js";

export const route = createRouter({
  "/api/battle/match": { POST: match },
  "/api/battle/resolve": { POST: battle },
  "/api/battle/ladder": { GET: ladder },
  "/api/battle/formation": { GET: formation, POST: formation },
  // Phase 9.2 — tournaments (schema, admin lifecycle, registration): rides
  // this existing domain rather than a new serverless function.
  "/api/battle/tournaments": { GET: tournaments },
  "/api/battle/tournament/register": { POST: tournamentRegister },
  "/api/battle/tournament/withdraw": { POST: tournamentWithdraw },
});
