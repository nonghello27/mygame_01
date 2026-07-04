// One of 6 domain routers behind the 6 Vercel serverless functions
// (Hobby plan caps a deployment at 12; grouping by domain keeps room to
// grow). This table owns the `trainer` domain's URLs;
// api/trainer/[...route].js (prod) and vite.config.js's dev middleware
// (local) both just call route().
//
// URLs renamed from the old single-function router to avoid the domain
// prefix colliding with an endpoint name: /api/me -> /api/trainer/me,
// /api/classes -> /api/trainer/classes, /api/progression ->
// /api/trainer/progression, /api/trainer-skills -> /api/trainer/skills.
//
// /api/trainer/inventory (Phase 7.1) follows the same precedent: the
// ROADMAP draft wrote plain /api/inventory, but a new top-level api/ file
// would cost another Vercel function, so it's grouped under this domain.
//
// /api/trainer/equipment/equip (Phase 7.2 step A) and
// /api/trainer/equipment/enhance (step B) are the same precedent again:
// each is a new endpoint inside an existing domain, so it's just another
// row in this table rather than a new api/ file.
//
// /api/trainer/runes/socket (Phase 7.3 step A) follows the same precedent:
// socket/unsocket one owned rune onto/from an owned monster.
//
// /api/trainer/runes/repair (Phase 7.3 step B) is the same precedent again:
// fully recharge one owned rune, paying its def's flat repair_gold.
//
// /api/trainer/summon (Phase 7.4 step A) follows the same precedent again:
// GET lists the enabled Summon Hall banners, POST pulls one — the first real
// acquisition path (before this, only the admin-gated POST /api/admin/grant
// could put anything in a trainer's inventory or roster).

import { createRouter } from "../http.js";
import { me } from "../routes/me.js";
import { classes } from "../routes/classes.js";
import { progression } from "../routes/progression.js";
import { trainerSkills } from "../routes/trainerSkills.js";
import { inventory } from "../routes/inventory.js";
import { equip, enhance } from "../routes/equipment.js";
import { socket, repair } from "../routes/runes.js";
import { summonHall, summon } from "../routes/summon.js";

export const route = createRouter({
  "/api/trainer/me": { GET: me },
  "/api/trainer/classes": { GET: classes },
  "/api/trainer/progression": { GET: progression, POST: progression },
  "/api/trainer/skills": { POST: trainerSkills },
  "/api/trainer/inventory": { GET: inventory },
  "/api/trainer/equipment/equip": { POST: equip },
  "/api/trainer/equipment/enhance": { POST: enhance },
  "/api/trainer/runes/socket": { POST: socket },
  "/api/trainer/runes/repair": { POST: repair },
  "/api/trainer/summon": { GET: summonHall, POST: summon },
});
