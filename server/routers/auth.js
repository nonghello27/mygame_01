// One of 7 domain routers behind the 7 Vercel serverless functions
// (Hobby plan caps a deployment at 12; grouping by domain keeps room to
// grow). This table owns the `auth` domain's URLs; api/auth/[...route].js
// (prod) and vite.config.js's dev middleware (local) both just call route().

import { createRouter } from "../http.js";
import { login, logout } from "../routes/auth.js";

export const route = createRouter({
  "/api/auth/login": { POST: login },
  "/api/auth/logout": { POST: logout },
});
