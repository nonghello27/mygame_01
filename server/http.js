// HTTP plumbing shared by the routers and every route handler: JSON in/out
// helpers, the createRouter() dispatch factory, plus an Error carrying the
// HTTP status the router should respond with (the router's catch passes
// e.status straight through).

/**
 * Build a route(req, res) dispatcher from a static
 * { pathname: { METHOD: handler } } table. Each domain in server/routers/
 * calls this with its own table; the returned function owns the
 * cross-cutting HTTP concerns so handlers keep only the happy path +
 * httpError throws:
 *   - unknown path   -> 404 { error: "not found" }
 *   - known path,
 *     wrong method   -> 405 naming the allowed methods
 *   - thrown errors  -> sendJson(res, e.status || 500, { error: ... })
 */
export function createRouter(routes) {
  return async function route(req, res) {
    // Strip the query string and trailing slashes, same as the dev
    // middleware always normalized endpoint names.
    const pathname = req.url.split("?")[0].replace(/\/+$/, "");

    const methods = routes[pathname];
    if (!methods) return sendJson(res, 404, { error: "not found" });

    const handler = methods[req.method];
    if (!handler) {
      return sendJson(res, 405, { error: `${Object.keys(methods).join(" or ")} only` });
    }

    try {
      await handler(req, res);
    } catch (e) {
      sendJson(res, e.status || 500, { error: String(e?.message || e) });
    }
  };
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Send a JSON response. Uses only raw Node res methods so the same handler works
 * under Vercel functions and the local Vite Connect middleware.
 */
export function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

/**
 * Read and JSON-parse a request body. Vercel may already have parsed it onto
 * req.body; otherwise we drain the raw Node stream (the Vite dev middleware
 * leaves it untouched). Throws on malformed JSON so handlers fail loudly.
 */
export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}
