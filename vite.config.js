import { defineConfig, loadEnv } from "vite";

// Dev-only: serve the api/ serverless functions through Vite's middleware so
// `npm run dev` behaves like production (where Vercel runs them). Each request
// to /api/<name> is handled by api/<name>.js's default export. Secrets from .env
// (e.g. DATABASE_URL) are injected into process.env here — server-side only,
// never into the browser bundle.
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
        const name = req.url.split("?")[0].slice("/api/".length).replace(/\/+$/, "");
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.js`);
          await mod.default(req, res);
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
