// Shared helpers for the serverless API functions. Runs server-side only
// (Vercel functions in prod, the Vite dev middleware locally) so it can read the
// secret DATABASE_URL that is never shipped to the browser.

import { neon } from "@neondatabase/serverless";

let _sql;

/** Lazily open (and cache) the Neon connection from DATABASE_URL. */
export function db() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
  }
  return _sql;
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
