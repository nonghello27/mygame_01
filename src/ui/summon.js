// Summon Hall panel (Phase 7.4 step A): the first player-facing acquisition
// path — pull a banner, pay its cost, get a monster. Same tab-less panel
// shell as the other side panels; modeled directly on ui/inventory.js's
// shape (a msgs div + a body div, one refresh() that re-reads and
// re-renders, actions that disable their own button and surface server
// errors at the panel level). Pure presentation + action layer: cost text,
// the roll, and the minted monster all come from the server — this module
// never computes odds or outcomes (CLAUDE.md §1.1/§1.2).

import { fetchSummonHall, performSummon, fetchInventory } from "../services/content.js";
import { fetchMe } from "../services/auth.js";
import { showProfile } from "./auth.js";

let els = null;
let banners = null;  // last fetchSummonHall() result's `summons`
let items = [];       // this trainer's owned item stacks, for cost-name lookup only
let results = {};     // summonId -> last pull result, shown inline under that banner's card

export function initSummon() {
  els = {
    btn: document.getElementById("summonBtn"),
    panel: document.getElementById("summonPanel"),
    msgs: document.getElementById("summonMsgs"),
    body: document.getElementById("summonBody"),
  };
  els.btn.addEventListener("click", toggle);
}

async function toggle() {
  const opening = els.panel.hidden;
  els.panel.hidden = !opening;
  els.btn.textContent = opening ? "✨ Close Summon" : "✨ Summon";
  if (opening) await refresh();
}

/** Re-read the banner list + owned items (for cost-name display only), and re-render. */
async function refresh() {
  els.msgs.innerHTML = "";
  try {
    const [hall, inventory] = await Promise.all([
      fetchSummonHall(),
      fetchInventory().catch(() => null), // item-name lookup is a nicety — degrade to raw ids
    ]);
    banners = hall.summons;
    items = inventory?.items ?? [];
  } catch (e) {
    banners = null;
    pushMsg(`Could not load the Summon Hall: ${e.message}`, true);
  }
  renderBody();
}

/** After a gold-spending pull, refresh the header's gold chip the same way
 *  the inventory panel does after enhance/repair — best-effort, never blocks. */
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

// ---------- cost display ----------

function itemName(itemId) {
  return items.find((it) => it.defId === itemId)?.name ?? itemId;
}

/** One human-readable line per cost leg, joined with " + " — e.g.
 *  "100 gold" or "1× Summon Scroll" or "50 gold + 2× Summon Scroll". */
function costText(cost) {
  return cost.map((c) => c.type === "gold" ? `${c.amount} gold` : `${c.qty}× ${itemName(c.itemId)}`).join(" + ");
}

// ---------- shell ----------

function renderBody() {
  els.body.innerHTML = "";
  if (!banners) return;
  if (banners.length === 0) {
    els.body.appendChild(el("p", "summon-hint", "No banners are open right now — check back later."));
    return;
  }
  for (const b of banners) els.body.appendChild(bannerCard(b));
}

function bannerCard(b) {
  const card = el("div", "summon-card");

  const head = el("div", "summon-head");
  head.append(el("b", null, b.name), el("span", "summon-cost", costText(b.cost)));
  card.append(head);

  if (b.description) card.append(el("p", "summon-desc", b.description));

  const pullBtn = button("Summon", "btn primary summon-pull", async () => {
    pullBtn.disabled = true;
    els.msgs.innerHTML = "";
    try {
      const result = await performSummon(b.id);
      items = result.inventory?.items ?? items;
      results[b.id] = result;
      refreshProfile(); // fire-and-forget, mirrors gold shown by farm.js's showProfile()
      pushMsg(`Summoned ${result.monster.name}!`);
      renderBody();
    } catch (e) {
      pushMsg(e.message, true);
      pullBtn.disabled = false;
    }
  });
  card.append(pullBtn);

  const result = results[b.id];
  if (result) card.append(resultBlock(result));

  return card;
}

/** The minted monster + new gold balance, shown under the card that summoned
 *  it. Sprite sheets need the chroma/sheet handling ui/board.js and
 *  ui/admin.js own — this panel keeps to the emoji fallback, same as every
 *  other non-board card in the game. */
function resultBlock(result) {
  const box = el("div", "summon-result");
  box.append(el("span", "summon-emoji", result.monster.emoji || "❔"));
  const txt = el("div", "summon-result-txt");
  txt.append(
    el("b", null, result.monster.name),
    el("small", null, `${result.monster.speciesId} · ${result.monster.element}`),
  );
  box.append(txt);
  box.append(el("span", "summon-gold", `🪙 ${result.gold}`));
  return box;
}
