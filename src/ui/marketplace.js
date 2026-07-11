// Marketplace panel (Phase 8, Round 4): the first player-to-player economy.
// Two tabs — Browse (search/filter open listings + Buy) and My Listings
// (cancel an open listing, see sold/cancelled history, and list a new good
// from the trainer's own inventory/roster). Same tab-panel shell as the
// Inventory panel (ui/inventory.js): a tab strip, a msgs div, a body div,
// one refresh() that re-reads and re-renders. Pure presentation + action
// layer — price, ownership, and every transfer are decided server-side
// (CLAUDE.md §1.1); this module never computes a total or a balance, it only
// shows what the server just handed back.
//
// "Yours" detection: the browse response doesn't carry a sellerId (only a
// sellerName, which isn't guaranteed unique), so ownership is inferred by
// intersecting browse listing ids against the caller's OWN open listing ids
// from /api/market/mine (fetched alongside browse on every refresh) — exact
// and race-free, since both endpoints read the same table by primary key.

import {
  fetchMarket, fetchMyListings, createListing, buyListing, cancelListing,
  fetchInventory, loadFarm,
} from "../services/content.js";
import { fetchMe } from "../services/auth.js";
import { showProfile } from "./auth.js";
import { registerView } from "./views.js";
import { goodIconEl } from "./goodsMedia.js";

const TABS = [
  ["browse", "🔍 Browse"],
  ["mine", "📋 My Listings"],
];

const KIND_OPTIONS = [
  ["", "All"],
  ["item", "Item"],
  ["equipment", "Equipment"],
  ["rune", "Rune"],
  ["monster", "Monster"],
];

const SELL_KIND_OPTIONS = [
  ["item", "Item"],
  ["equipment", "Equipment"],
  ["rune", "Rune"],
  ["monster", "Monster"],
];

const LIMIT = 20;

let els = null;
let tab = "browse";

// browse state
let filters = { kind: "", q: "", minPrice: "", maxPrice: "" };
let offset = 0;
let browseListings = [];
let hasMore = false;

// mine state
let mineListings = [];
let ownOpenIds = new Set();

// sell-something state (lazy-loaded picker over the trainer's own goods)
let sellOpen = false;
let inventory = null; // fetchInventory() result, loaded on demand
let roster = null;    // loadFarm() result, loaded on demand
let sell = { kind: "item", selectedId: null, qty: 1, price: "" };

export function initMarketplace() {
  els = {
    btn: document.getElementById("marketBtn"),
    panel: document.getElementById("marketPanel"),
    tabs: document.getElementById("marketTabs"),
    msgs: document.getElementById("marketMsgs"),
    body: document.getElementById("marketBody"),
  };
  registerView("marketplace", { button: els.btn, el: els.panel, onShow: refresh });
}

/** Re-read browse (from offset 0, current filters) + the caller's own
 *  listings (needed for both the "yours" badge on browse AND the My
 *  Listings tab), and re-render. */
async function refresh() {
  els.msgs.innerHTML = "";
  offset = 0;
  try {
    const [browse, mine] = await Promise.all([
      fetchMarket(currentQuery()),
      fetchMyListings(),
    ]);
    browseListings = browse.listings;
    hasMore = browse.listings.length === LIMIT;
    mineListings = mine.listings;
    ownOpenIds = new Set(mineListings.filter((l) => l.status === "open").map((l) => l.id));
  } catch (e) {
    browseListings = [];
    mineListings = [];
    ownOpenIds = new Set();
    pushMsg(`Could not load the marketplace: ${e.message}`, true);
  }
  renderTabs();
  renderBody();
}

function currentQuery() {
  return {
    kind: filters.kind || undefined,
    q: filters.q || undefined,
    minPrice: filters.minPrice || undefined,
    maxPrice: filters.maxPrice || undefined,
    limit: LIMIT,
    offset,
  };
}

/** Re-fetch browse only (filters/offset already updated), leaving My
 *  Listings state untouched — used by Search and Load more. */
async function refetchBrowse({ append } = {}) {
  els.msgs.innerHTML = "";
  try {
    const res = await fetchMarket(currentQuery());
    browseListings = append ? browseListings.concat(res.listings) : res.listings;
    hasMore = res.listings.length === LIMIT;
  } catch (e) {
    pushMsg(`Could not load listings: ${e.message}`, true);
  }
  renderBody();
}

/** After a gold-spending action (buy), refresh the header's gold chip the
 *  same way the other panels do — best-effort, never blocks. */
async function refreshProfile() {
  const trainer = await fetchMe();
  if (trainer) showProfile(trainer);
}

function pushMsg(text, isError = false) {
  const p = document.createElement("p");
  p.textContent = text;
  p.classList.toggle("err", isError);
  els.msgs.appendChild(p);
}

// ---------- tiny DOM helpers ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text, cls, onClick) {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function badge(text, extraCls) {
  return el("span", extraCls ? `mkt-badge ${extraCls}` : "mkt-badge", text);
}

// ---------- shell ----------

function renderTabs() {
  els.tabs.innerHTML = "";
  for (const [id, label] of TABS) {
    els.tabs.appendChild(button(label, "mkt-tab" + (id === tab ? " active" : ""), () => selectTab(id)));
  }
}

function selectTab(id) {
  if (id === tab) return;
  tab = id;
  renderTabs();
  renderBody();
}

function renderBody() {
  els.body.innerHTML = "";
  if (tab === "browse") browseTab();
  else mineTab();
}

function emptyState(text) {
  els.body.appendChild(el("p", "mkt-hint", text));
}

// ---------- browse tab ----------

function browseTab() {
  els.body.appendChild(filterBar());

  if (browseListings.length === 0) {
    emptyState("No listings match your search.");
    return;
  }

  const list = el("div", "mkt-list");
  for (const l of browseListings) list.appendChild(listingCard(l));
  els.body.appendChild(list);

  if (hasMore) {
    els.body.appendChild(button("Load more", "btn ghost mkt-small", async (e) => {
      e.target.disabled = true;
      offset += LIMIT;
      await refetchBrowse({ append: true });
    }));
  }
}

function filterBar() {
  const bar = el("div", "mkt-filters");

  const kindSelect = el("select", "mkt-select");
  for (const [value, label] of KIND_OPTIONS) {
    const opt = el("option", null, label);
    opt.value = value;
    if (value === filters.kind) opt.selected = true;
    kindSelect.appendChild(opt);
  }

  const qInput = el("input", "mkt-input");
  qInput.type = "text";
  qInput.placeholder = "Search name…";
  qInput.value = filters.q;

  const minInput = el("input", "mkt-input mkt-input-num");
  minInput.type = "number";
  minInput.min = "0";
  minInput.placeholder = "Min 🪙";
  minInput.value = filters.minPrice;

  const maxInput = el("input", "mkt-input mkt-input-num");
  maxInput.type = "number";
  maxInput.min = "0";
  maxInput.placeholder = "Max 🪙";
  maxInput.value = filters.maxPrice;

  const searchBtn = button("Search", "btn primary mkt-small", async () => {
    filters = { kind: kindSelect.value, q: qInput.value.trim(), minPrice: minInput.value, maxPrice: maxInput.value };
    offset = 0;
    await refetchBrowse();
  });

  bar.append(kindSelect, qInput, minInput, maxInput, searchBtn);
  return bar;
}

function listingCard(l) {
  const card = el("div", "mkt-card");

  const head = el("div", "mkt-head");
  head.append(badge(kindLabel(l.kind)), el("span", "mkt-price", `${l.price} 🪙`));
  card.append(head);

  card.append(goodBlock(l));

  const foot = el("div", "mkt-foot");
  foot.append(el("span", "mkt-seller", `Seller: ${l.sellerName}`));

  if (ownOpenIds.has(l.id)) {
    foot.append(badge("Yours", "mkt-yours"));
  } else {
    const buyBtn = button("Buy", "btn primary mkt-small", async () => {
      buyBtn.disabled = true;
      els.msgs.innerHTML = "";
      try {
        const result = await buyListing(l.id);
        browseListings = browseListings.filter((x) => x.id !== l.id);
        pushMsg(`Bought ${goodName(l)} for ${result.listing.price} 🪙 — new balance ${result.gold} 🪙`);
        refreshProfile();
        renderBody();
      } catch (e) {
        pushMsg(e.message, true);
        buyBtn.disabled = false;
      }
    });
    foot.append(buyBtn);
  }
  card.append(foot);

  return card;
}

function kindLabel(kind) {
  return { item: "Item", equipment: "Equipment", rune: "Rune", monster: "Monster" }[kind] ?? kind;
}

function goodName(l) {
  return l.good?.name ?? l.defId ?? "the item";
}

// Item/equipment/rune kinds each render as an icon + text column, the same
// "icon head" shape monster listings already used (mkt-mon-head) — dir picks
// the goodIconEl() lookup folder per kind.
const GOODS_ICON_DIR = { item: "items", equipment: "equipment", rune: "runes" };

/** Kind-specific display detail — renders whatever the enriched listing
 *  actually carries (server/repos/market.js's enrichListings()). */
function goodBlock(l) {
  const box = el("div", "mkt-good");
  if (!l.good) {
    box.append(el("p", "mkt-desc", "(listing details unavailable)"));
    return box;
  }

  if (l.kind === "item") {
    const head = el("div", "mkt-good-head");
    head.append(goodIconEl(GOODS_ICON_DIR.item, l.good), el("b", null, `${l.qty}× ${l.good.name}`));
    box.append(head);
    if (l.good.description) box.append(el("p", "mkt-desc", l.good.description));
  } else if (l.kind === "equipment") {
    const head = el("div", "mkt-good-head");
    head.append(goodIconEl(GOODS_ICON_DIR.equipment, l.good), el("b", null, l.good.name));
    box.append(head);
    const line = [`${l.good.domain} · ${l.good.slot}`];
    if (l.good.enhanceLevel) line.push(`+${l.good.enhanceLevel}`);
    box.append(el("p", "mkt-desc", line.join(" · ")));
  } else if (l.kind === "rune") {
    const head = el("div", "mkt-good-head");
    head.append(goodIconEl(GOODS_ICON_DIR.rune, l.good), el("b", null, l.good.name));
    box.append(head);
    const line = [`Lv ${l.good.level}`, `${l.good.chargesLeft}/${l.good.maxCharges} charges`];
    box.append(el("p", "mkt-desc", line.join(" · ")));
    if (l.good.broken) box.append(badge("BROKEN", "mkt-broken"));
  } else {
    // monster
    const head = el("div", "mkt-mon-head");
    head.append(el("span", "mkt-mon-emoji", l.good.emoji || "❔"));
    const txt = el("div");
    txt.append(el("b", null, l.good.name), el("small", null, `${l.good.speciesId} · ${l.good.element}`));
    head.append(txt);
    box.append(head);
    const a = l.good.attrs, b = l.good.base;
    if (a) box.append(el("p", "mkt-desc", `STR ${a.str} · AGI ${a.agi} · VIT ${a.vit} · INT ${a.int} · DEX ${a.dex}`));
    if (b) box.append(el("p", "mkt-desc", `HP ${b.hp} · ATK ${b.atk} · SPD ${b.spd}`));
  }
  return box;
}

// ---------- my listings tab ----------

function mineTab() {
  els.body.appendChild(sellSection());

  const open = mineListings.filter((l) => l.status === "open");
  const history = mineListings.filter((l) => l.status !== "open");

  els.body.appendChild(el("h4", "mkt-subhead", "Open listings"));
  if (open.length === 0) {
    els.body.appendChild(el("p", "mkt-hint", "You have nothing listed right now."));
  } else {
    const list = el("div", "mkt-list");
    for (const l of open) list.appendChild(mineOpenRow(l));
    els.body.appendChild(list);
  }

  els.body.appendChild(el("h4", "mkt-subhead", "History"));
  if (history.length === 0) {
    els.body.appendChild(el("p", "mkt-hint", "No past sales or cancellations yet."));
  } else {
    const list = el("div", "mkt-list");
    for (const l of history) list.appendChild(mineHistoryRow(l));
    els.body.appendChild(list);
  }
}

function mineOpenRow(l) {
  const card = el("div", "mkt-card");
  const head = el("div", "mkt-head");
  head.append(badge(kindLabel(l.kind)), el("span", "mkt-price", `${l.price} 🪙`));
  card.append(head);
  card.append(goodBlock(l));

  const cancelBtn = button("Cancel listing", "btn ghost mkt-small", async () => {
    cancelBtn.disabled = true;
    els.msgs.innerHTML = "";
    try {
      const result = await cancelListing(l.id);
      mineListings = result.listings;
      ownOpenIds = new Set(mineListings.filter((x) => x.status === "open").map((x) => x.id));
      browseListings = browseListings.filter((x) => x.id !== l.id);
      pushMsg(`Cancelled — ${goodName(l)} returned to you.`);
      renderBody();
    } catch (e) {
      pushMsg(e.message, true);
      cancelBtn.disabled = false;
    }
  });
  card.append(cancelBtn);
  return card;
}

function mineHistoryRow(l) {
  const card = el("div", "mkt-card mkt-history");
  const head = el("div", "mkt-head");
  head.append(badge(kindLabel(l.kind)), el("span", "mkt-price", `${l.price} 🪙`));
  card.append(head);
  card.append(goodBlock(l));

  const foot = el("div", "mkt-foot");
  const statusLabel = { sold: "Sold", cancelled: "Cancelled" }[l.status] ?? l.status;
  const bits = [statusLabel];
  if (l.status === "sold" && l.buyerName) bits.push(`to ${l.buyerName}`);
  if (l.closedAt) bits.push(new Date(l.closedAt).toLocaleString());
  foot.append(el("span", "mkt-seller", bits.join(" · ")));
  card.append(foot);
  return card;
}

// ---------- sell-something picker ----------

function sellSection() {
  const box = el("div", "mkt-sell");
  const toggleBtn = button(sellOpen ? "Cancel" : "Sell something", "btn ghost mkt-small", async () => {
    sellOpen = !sellOpen;
    if (sellOpen) await loadSellData();
    else renderBody();
  });
  box.append(toggleBtn);

  if (sellOpen) box.append(sellForm());
  return box;
}

async function loadSellData() {
  if (inventory && roster) return renderBody();
  els.msgs.innerHTML = "";
  try {
    const [inv, farm] = await Promise.all([fetchInventory(), loadFarm()]);
    inventory = inv;
    roster = farm;
  } catch (e) {
    pushMsg(`Could not load your goods: ${e.message}`, true);
  }
  renderBody();
}

function sellForm() {
  const form = el("div", "mkt-sell-form");
  if (!inventory || !roster) {
    form.append(el("p", "mkt-hint", "Loading…"));
    return form;
  }

  const kindSelect = el("select", "mkt-select");
  for (const [value, label] of SELL_KIND_OPTIONS) {
    const opt = el("option", null, label);
    opt.value = value;
    if (value === sell.kind) opt.selected = true;
    kindSelect.appendChild(opt);
  }
  kindSelect.addEventListener("change", () => {
    sell = { kind: kindSelect.value, selectedId: null, qty: 1, price: sell.price };
    renderBody();
  });
  form.append(kindSelect);

  const candidates = sellCandidates();
  if (candidates.length === 0) {
    form.append(el("p", "mkt-hint", "Nothing sellable of that kind right now."));
    return form;
  }

  const pickSelect = el("select", "mkt-select");
  for (const c of candidates) {
    const opt = el("option", null, c.label);
    opt.value = String(c.id);
    if (sell.selectedId === c.id) opt.selected = true;
    pickSelect.appendChild(opt);
  }
  if (sell.selectedId === null) sell.selectedId = candidates[0].id;
  pickSelect.value = String(sell.selectedId);
  pickSelect.addEventListener("change", () => {
    sell.selectedId = sell.kind === "item" ? pickSelect.value : Number(pickSelect.value);
  });
  form.append(pickSelect);

  if (sell.kind === "item") {
    const chosen = candidates.find((c) => c.id === pickSelect.value) ?? candidates[0];
    const qtyInput = el("input", "mkt-input mkt-input-num");
    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.max = String(chosen.maxQty);
    qtyInput.value = String(sell.qty);
    qtyInput.addEventListener("input", () => { sell.qty = Number(qtyInput.value) || 1; });
    form.append(qtyInput);
  }

  const priceInput = el("input", "mkt-input mkt-input-num");
  priceInput.type = "number";
  priceInput.min = "1";
  priceInput.placeholder = "Price 🪙";
  priceInput.value = sell.price;
  priceInput.addEventListener("input", () => { sell.price = priceInput.value; });
  form.append(priceInput);

  const listBtn = button("List for sale", "btn primary mkt-small", async () => {
    const price = Number(sell.price);
    if (!Number.isInteger(price) || price <= 0) {
      pushMsg("Enter a positive whole-number price.", true);
      return;
    }
    listBtn.disabled = true;
    els.msgs.innerHTML = "";
    try {
      const body = sell.kind === "item"
        ? { kind: "item", defId: sell.selectedId, qty: sell.qty, price }
        : { kind: sell.kind, refId: sell.selectedId, price };
      const result = await createListing(body);
      mineListings = result.listings;
      ownOpenIds = new Set(mineListings.filter((x) => x.status === "open").map((x) => x.id));
      inventory = null; // the escrowed good left the bag/roster — force a fresh read next time
      roster = null;
      sellOpen = false;
      sell = { kind: "item", selectedId: null, qty: 1, price: "" };
      pushMsg(`Listed ${result.listing.qty > 1 ? `${result.listing.qty}× ` : ""}for ${result.listing.price} 🪙.`);
      renderBody();
    } catch (e) {
      pushMsg(e.message, true);
      listBtn.disabled = false;
    }
  });
  form.append(listBtn);

  return form;
}

/** One {id, label, maxQty?} entry per sellable candidate of `sell.kind`. */
function sellCandidates() {
  if (sell.kind === "item") {
    return inventory.items
      .filter((it) => it.qty > 0)
      .map((it) => ({ id: it.defId, label: `${it.name} (×${it.qty})`, maxQty: it.qty }));
  }
  if (sell.kind === "equipment") {
    const bag = [
      ...inventory.equipment.trainer.filter((e) => e.equippedSlot == null),
      ...inventory.equipment.monster.filter((e) => e.monsterId == null),
    ];
    return bag.map((e) => ({ id: e.id, label: `${e.name} (${e.domain} · ${e.slot})` }));
  }
  if (sell.kind === "rune") {
    return inventory.runes
      .filter((r) => r.monsterId == null)
      .map((r) => ({ id: r.id, label: `${r.name} (Lv ${r.level}${r.broken ? ", broken" : ""})` }));
  }
  // monster
  return roster.monsters
    .filter((m) => !(m.busyUntil && new Date(m.busyUntil) > new Date()))
    .map((m) => ({ id: m.id, label: m.name }));
}
