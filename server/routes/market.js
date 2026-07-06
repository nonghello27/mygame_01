// GET  /api/market/browse     ?kind&q&minPrice&maxPrice&limit&offset ->
//   { listings } — open listings only, newest first, search/filter + paging.
//   (Not the bare /api/market — a Vercel catch-all [...route].js can't match
//   its own bare prefix, so browse lives one segment down.)
// GET  /api/market/mine       -> { listings } — every listing the caller has
//   ever created, any status.
// POST /api/market/list       { kind, refId?, defId?, qty?, price } ->
//   { listing, listings } — escrow + create one listing.
// POST /api/market/buy        { listingId } -> { listing, gold }.
// POST /api/market/cancel     { listingId } -> { listing, listings }.
//
// Same "act, then hand back everything the client needs to refresh"
// precedent as equipment's equip()/enhance() and runes' socket()/repair() —
// validation, claiming, and every SQL statement live in
// server/services/market.js; these handlers only wire session + request to
// that use-case.

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import {
  browseListings, myListings, createListing, buyListing, cancelListing,
} from "../services/market.js";

export async function browse(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const sql = db();
  // createRouter strips the query string for ROUTING only — req.url still
  // carries it here (same precedent as server/routes/admin.js's monsters()).
  const params = new URL(req.url, "http://localhost").searchParams;
  const query = {
    kind: params.get("kind") ?? undefined,
    q: params.get("q") ?? undefined,
    minPrice: params.get("minPrice") ?? undefined,
    maxPrice: params.get("maxPrice") ?? undefined,
    limit: params.get("limit") ?? undefined,
    offset: params.get("offset") ?? undefined,
  };
  sendJson(res, 200, await browseListings(sql, query));
}

export async function mine(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const sql = db();
  sendJson(res, 200, await myListings(sql, trainerId));
}

export async function list(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  const sql = db();
  sendJson(res, 200, await createListing(sql, trainerId, body));
}

export async function buy(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  const sql = db();
  sendJson(res, 200, await buyListing(sql, trainerId, body));
}

export async function cancel(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  const sql = db();
  sendJson(res, 200, await cancelListing(sql, trainerId, body));
}
