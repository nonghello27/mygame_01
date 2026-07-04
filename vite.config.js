import { defineConfig, loadEnv } from "vite";

// Dev-only: serve the API through Vite's middleware so `npm run dev` behaves
// like production (where Vercel runs 6 domain-grouped serverless functions,
// one per api/<domain>/[...route].js — Hobby plan caps a deployment at 12).
// Every request to /api/* is dispatched to the matching server/routers/
// module by prefix, mirroring how Vercel's file-based routing resolves the
// same URLs in prod. Secrets from .env (e.g. DATABASE_URL) are injected into
// process.env here — server-side only, never into the browser bundle.
function apiDevServer(env) {
  return {
    name: "api-dev-server",
    apply: "serve",
    configureServer(server) {
      for (const [k, v] of Object.entries(env)) {
        if (!k.startsWith("VITE_") && process.env[k] === undefined) process.env[k] = v;
      }
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/api/")) return next();
        const pathname = req.url.split("?")[0];
        const routerPath = pathname === "/api/activities" ? "/server/routers/activities.js"
          : pathname.startsWith("/api/auth/") ? "/server/routers/auth.js"
          : pathname.startsWith("/api/battle/") ? "/server/routers/battle.js"
          : pathname.startsWith("/api/trainer/") ? "/server/routers/trainer.js"
          : pathname.startsWith("/api/admin/") ? "/server/routers/admin.js"
          : pathname.startsWith("/api/adventure/") ? "/server/routers/adventure.js"
          : null;
        if (!routerPath) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        try {
          const { route } = await server.ssrLoadModule(routerPath);
          await route(req, res);
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(e?.message || e) }));
        }
      });
    },
  };
}

// Relative base keeps built asset paths portable across hosts
// (Vercel, GitHub Pages, plain static servers, etc.).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ""); // "" prefix => load ALL vars, incl. non-VITE_
  return {
    base: "./",
    plugins: [apiDevServer(env)],
    server: {
      open: true,
      port: 5173,
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
