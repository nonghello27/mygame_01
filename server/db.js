// Neon connection for the API. Runs server-side only (the Vercel function in
// prod, the Vite dev middleware locally) so it can read the secret
// DATABASE_URL that is never shipped to the browser.

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
