// Setup Team panel (Phase 10.5) — replaces the Phase 10.2 battlefield party
// strip. Same contract: it owns the REMEMBERED party ids (`getPartyIds()`,
// null = server default) and never opens a match itself — `main.js` passes
// `onSaveTeam` in. Roster read borrows loadFarm(), the same source the old
// battlefield party strip read; drag-and-drop adapts ui/dragdrop.js's
// pointer-event clone pattern (works on touch: a small movement threshold
// before a drag actually starts keeps a plain tap a click).
// Phase 10.8: cards render via board.js's unitCardEl over deriveStats(base,
// attrs) — the SAME pure derivation the server freezes into snapshots
// (shared/ is importable by src/ by design); display-only, never sent
// anywhere.

import { loadFarm } from "../services/content.js";
import { state } from "../core/state.js";
import { registerView } from "./views.js";
import { unitCardEl } from "./board.js";
import { deriveStats } from "../../shared/rules/formulas.js";

const BUSY_LABEL = {
  work: "Working",
  training: "Training",
  adventure: "On adventure",
  tournament: "In tournament",
  gvg: "In GVG",
};
const PARTY_SIZE = 3;
const DRAG_THRESHOLD = 5; // px of movement before a pointerdown becomes a drag

let els = null;
let onSaveTeam = async () => {};
let roster = null;          // last loadFarm().monsters, or null if the read failed
let slots = [null, null, null]; // monster ids, index = lane
let chosenIds = null;       // null = "server default"; otherwise the last saved picks
let sortKey = "order";      // 'order' | 'name' | 'power'
let sortDir = "asc";        // 'asc' | 'desc'
let detailId = null;        // monster id shown in the detail area, or null

/** @param {{onSaveTeam: () => void|Promise<void>}} opts */
export function initTeam({ onSaveTeam: cb } = {}) {
  onSaveTeam = cb || onSaveTeam;
  els = {
    btn: document.getElementById("teamBtn"),
    panel: document.getElementById("teamPanel"),
    msgs: document.getElementById("teamMsgs"),
    body: document.getElementById("teamBody"),
  };
  registerView("team", { button: els.btn, el: els.panel, onShow: refresh });
}

/**
 * The ids to send with the NEXT match, or null for the server default (first
 * 3 available) — read by main.js's openMatch().
 */
export function getPartyIds() {
  return chosenIds;
}

/**
 * Re-render the panel if it's open — main.js calls this after every match
 * open. Cheap no-op while closed.
 */
export async function renderTeam() {
  if (!els?.panel || els.panel.hidden) return;
  await refresh();
}

/** Re-read the roster, prefill the slots from what's actually fielded now,
 *  and re-render. Never throws — a failed read just leaves the body empty. */
async function refresh() {
  els.msgs.innerHTML = "";
  try {
    const farm = await loadFarm();
    roster = farm.monsters;
  } catch (e) {
    roster = null;
    pushMsg(`Could not load the roster: ${e.message}`, true);
  }
  slots = fieldedIds();
  if (detailId != null && !monsterById(detailId)) detailId = null;
  render();
}

/** Open (or re-focus) the detail area for one roster monster. */
function showDetail(id) {
  detailId = id;
  render();
}

function fieldedIds() {
  const ids = state.armyA.map((u) => u.monsterId).filter((id) => id != null);
  const out = [null, null, null];
  for (let i = 0; i < PARTY_SIZE; i++) out[i] = ids[i] ?? null;
  return out;
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

// ---------- pure helpers ----------

/** Monsters have no level of their own — this is a display-only stand-in
 *  strength score, never sent anywhere. */
function powerOf(m) {
  const a = m.attrs || {};
  return (a.str ?? 0) + (a.agi ?? 0) + (a.vit ?? 0) + (a.int ?? 0) + (a.dex ?? 0);
}

function isBusy(m) {
  return m.busyUntil && new Date(m.busyUntil) > new Date();
}

/** A display lane for one roster monster: derived stats at full HP, alive —
 *  exactly what the battlefield card markup expects. Display-only. */
function laneView(m) {
  const d = deriveStats(m.base, m.attrs);
  return { ...m, ...d, hp: d.maxHp, alive: true };
}

function sortedRoster() {
  if (!roster) return [];
  const list = [...roster];
  if (sortKey === "name") {
    list.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortKey === "power") {
    list.sort((a, b) => powerOf(a) - powerOf(b));
  } // 'order' = acquisition/id order, which is exactly the array order roster arrives in
  if (sortDir === "desc") list.reverse();
  return list;
}

/** Assign `id` into `slots[slotIdx]`, first clearing any OTHER slot that
 *  already held it (no duplicates). Returns a new array. */
function assignToSlot(current, slotIdx, id) {
  const next = current.map((v) => (v === id ? null : v));
  next[slotIdx] = id;
  return next;
}

// ---------- rendering ----------

function render() {
  els.body.innerHTML = "";
  if (!roster) return; // the msg already explains why

  els.body.append(slotsRow(), sortBar(), rosterRow());
  const detail = detailArea();
  if (detail) els.body.append(detail);
  els.body.append(footerBar());
}

function monsterById(id) {
  return roster?.find((m) => m.id === id) ?? null;
}

/** Renders the 3 lane columns RIGHT-to-LEFT in data order (Lane 3, Lane 2,
 *  Lane 1 left→right) so the row visually matches the battlefield, where
 *  army A renders back→front with lane 1 (the front, first to fight)
 *  rightmost, nearest the clash zone. `slots` stays index 0 = lane 1 = front
 *  throughout — only the DOM append order flips, never the data. */
function slotsRow() {
  const row = el("div", "team-slots");
  for (let i = PARTY_SIZE - 1; i >= 0; i--) {
    const id = slots[i];
    const slot = el("div", "team-slot" + (id == null ? " empty" : ""));
    slot.dataset.slot = String(i);
    if (id == null) {
      const label = i === 0 ? "Lane 1 (front) — drop a monster" : `Lane ${i + 1} — drop a monster`;
      slot.appendChild(el("span", "team-slot-empty", label));
    } else {
      const m = monsterById(id);
      const card = m ? unitCardEl(laneView(m), String(i + 1)) : el("div", "team-slot-empty", `#${id}`);
      if (m) {
        const clear = button("✕", "team-slot-clear", (e) => {
          e.stopPropagation();
          slots = slots.map((v, idx) => (idx === i ? null : v));
          render();
        });
        card.appendChild(clear);
        card.addEventListener("click", () => showDetail(m.id));
        enableSlotDrag(card, i);
      }
      slot.appendChild(card);
    }
    row.appendChild(slot);
  }
  return row;
}

function sortBar() {
  const bar = el("div", "team-sortbar");
  const select = el("select", "team-sort");
  for (const [value, label] of [["order", "Order"], ["name", "Name"], ["power", "Power"]]) {
    const opt = el("option", null, label);
    opt.value = value;
    if (value === sortKey) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => {
    sortKey = select.value;
    render();
  });
  const dir = button(sortDir === "asc" ? "⬆ Asc" : "⬇ Desc", "btn ghost team-dir", () => {
    sortDir = sortDir === "asc" ? "desc" : "asc";
    render();
  });
  bar.append(select, dir);
  return bar;
}

function rosterRow() {
  const row = el("div", "team-roster");
  for (const m of sortedRoster()) {
    const busy = isBusy(m);
    const slotIdx = slots.indexOf(m.id);
    const slotted = slotIdx !== -1;
    const card = unitCardEl(laneView(m), "");
    if (busy) card.classList.add("busy");
    if (slotted) card.classList.add("slotted");
    if (busy) {
      card.append(el("span", "team-card-busy-tag", `Busy: ${BUSY_LABEL[m.busyKind] ?? m.busyKind ?? "?"}`));
    }
    if (slotted) {
      card.append(el("span", "team-card-badge", String(slotIdx + 1)));
    }
    // Busy cards get no click/drag — tap-to-place is DELETED (10.8): a click
    // now opens the detail area, which is where lane placement/removal moves
    // to as the no-drag path (touch users: tap = detail, place from there).
    if (!busy) {
      card.addEventListener("click", () => showDetail(m.id));
      enableRosterDrag(card, m.id);
    }
    row.appendChild(card);
  }
  return row;
}

/** The click-for-detail area (Phase 10.8) — null when nothing is selected or
 *  the selected monster left the roster. Also the no-drag placement path
 *  (touch: tap a card = detail, place/remove from here) that replaces
 *  10.5's tap-to-place-in-first-empty-slot behavior. */
function detailArea() {
  if (detailId == null) return null;
  const m = monsterById(detailId);
  if (!m) return null;

  const d = deriveStats(m.base, m.attrs);
  const busy = isBusy(m);
  const slotIdx = slots.indexOf(m.id);
  const slotted = slotIdx !== -1;

  const box = el("div", "team-detail");

  const header = el("div", "team-detail-header");
  header.append(el("span", "team-detail-emoji", m.emoji || "❔"));
  const head = el("div", "team-detail-head");
  head.append(el("div", "team-detail-name", m.name));
  head.append(el("div", "team-detail-sub", `${m.cls} · ${m.element}`));
  head.append(el("div", "team-detail-kind", `${m.attackKind}/${m.attackStyle} · ${m.targeting}`));
  header.append(head);
  header.append(button("✕", "team-slot-clear team-detail-close", () => {
    detailId = null;
    render();
  }));
  box.append(header);

  const stats = el("div", "team-detail-stats");
  stats.append(
    el("span", "team-detail-badge", `HP ${d.maxHp}`),
    el("span", "team-detail-badge", `ATK ${d.atkMin}–${d.atkMax}`),
    el("span", "team-detail-badge", `MATK ${d.matkMin}–${d.matkMax}`),
    el("span", "team-detail-badge", `SPD ${d.spd}`),
    el("span", "team-detail-badge", `CRIT ${d.crit}%`),
    el("span", "team-detail-badge", `EVA ${d.evade}%`),
    el("span", "team-detail-badge", `ACC ${d.acc}%`),
  );
  box.append(stats);

  const a = m.attrs || {};
  box.append(el("div", "team-detail-attrs",
    `STR ${a.str ?? 0} · AGI ${a.agi ?? 0} · VIT ${a.vit ?? 0} · INT ${a.int ?? 0} · DEX ${a.dex ?? 0}`));

  const skillsBox = el("div", "team-detail-skills");
  if (!m.skills?.length) {
    skillsBox.append(el("div", "team-detail-hint", "No skills."));
  } else {
    for (const sk of m.skills) {
      skillsBox.append(el("div", "team-detail-skill", `${sk.name} (Lv ${sk.level})`));
    }
  }
  box.append(skillsBox);

  if (busy) {
    box.append(el("div", "team-detail-busy", `Busy: ${BUSY_LABEL[m.busyKind] ?? m.busyKind ?? "?"}`));
  }

  const actions = el("div", "team-detail-actions");
  for (let i = PARTY_SIZE - 1; i >= 0; i--) {
    const label = i === 0 ? "Set lane 1 (front)" : `Set lane ${i + 1}`;
    const btn = button(label, "btn ghost", () => {
      slots = assignToSlot(slots, i, m.id);
      render();
    });
    btn.disabled = busy;
    actions.append(btn);
  }
  if (slotted) {
    actions.append(button("Remove from team", "btn ghost", () => {
      slots = slots.map((v, idx) => (idx === slotIdx ? null : v));
      render();
    }));
  }
  box.append(actions);

  return box;
}

function footerBar() {
  const bar = el("div", "team-bar");
  const canSave = slots.every((id) => id != null);
  const saveBtn = button("Save team", "btn primary", async () => {
    setButtonsDisabled(bar, true);
    els.msgs.innerHTML = "";
    chosenIds = [...slots];
    try {
      await onSaveTeam();
      pushMsg("Team fielded — same enemy, new lineup.");
    } catch (e) {
      pushMsg(e.message, true);
    } finally {
      await refresh();
    }
  });
  saveBtn.disabled = !canSave;
  bar.appendChild(saveBtn);

  bar.appendChild(button("Reset", "btn ghost", () => {
    slots = [null, null, null];
    render();
  }));

  if (chosenIds != null) {
    bar.appendChild(button("Default party", "btn ghost", async () => {
      setButtonsDisabled(bar, true);
      els.msgs.innerHTML = "";
      chosenIds = null;
      try {
        await onSaveTeam();
        pushMsg("Using the server's default party.");
      } catch (e) {
        pushMsg(e.message, true);
      } finally {
        await refresh();
      }
    }));
  }

  return bar;
}

function setButtonsDisabled(scope, disabled) {
  for (const b of scope.querySelectorAll("button")) b.disabled = disabled;
}

// ---------- drag & drop (adapted from ui/dragdrop.js's pointer-event pattern) ----------

let drag = null; // { source: {kind:'roster', id} | {kind:'slot', idx}, clone, startX, startY, dx, dy, started, target }

function beginPointerDrag(sourceEl, source, e) {
  const startX = e.clientX;
  const startY = e.clientY;
  let started = false;
  let clone = null;
  let dx = 0, dy = 0;

  function onMove(ev) {
    if (!started) {
      if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
      started = true;
      const rect = sourceEl.getBoundingClientRect();
      clone = sourceEl.cloneNode(true);
      clone.classList.add("team-drag-clone");
      clone.style.width = rect.width + "px";
      clone.style.left = rect.left + "px";
      clone.style.top = rect.top + "px";
      document.body.appendChild(clone);
      dx = startX - rect.left;
      dy = startY - rect.top;
      drag = { source, clone, target: null };
      sourceEl.classList.add("dragging-src");
    }
    if (!started || !drag) return;
    clone.style.left = ev.clientX - dx + "px";
    clone.style.top = ev.clientY - dy + "px";
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const tSlot = under ? under.closest(".team-slot") : null;
    if (drag.target && drag.target !== tSlot) drag.target.classList.remove("drop-target");
    if (tSlot) {
      tSlot.classList.add("drop-target");
      drag.target = tSlot;
    } else {
      drag.target = null;
    }
  }

  // Shared teardown for both a normal drop and an interrupted stream — never
  // leaves the pointermove listener, the clone, or a drop-target highlight
  // behind either way.
  function cleanup() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    sourceEl.classList.remove("dragging-src");
    if (drag?.target) drag.target.classList.remove("drop-target");
    if (clone) clone.remove();
  }

  function onUp() {
    const wasStarted = started;
    const targetSlot = drag?.target ?? null;
    cleanup();
    if (wasStarted) applyDrop(source, targetSlot ? Number(targetSlot.dataset.slot) : null);
    // else: a plain click — the element's own click handler runs separately
    drag = null;
  }

  // A touch scroll or other browser gesture interrupts the pointer stream
  // with `pointercancel`, not `pointerup` — tear down exactly like onUp but
  // WITHOUT applying a drop (a cancelled drag changes nothing).
  function onCancel() {
    cleanup();
    drag = null;
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
  window.addEventListener("pointercancel", onCancel, { once: true });
}

function applyDrop(source, targetSlotIdx) {
  if (source.kind === "roster") {
    if (targetSlotIdx == null) return; // dropped outside a slot: no-op
    slots = assignToSlot(slots, targetSlotIdx, source.id);
    render();
    return;
  }
  // source.kind === "slot"
  if (targetSlotIdx == null) {
    slots = slots.map((v, i) => (i === source.idx ? null : v));
    render();
    return;
  }
  if (targetSlotIdx === source.idx) return;
  const next = [...slots];
  [next[source.idx], next[targetSlotIdx]] = [next[targetSlotIdx], next[source.idx]];
  slots = next;
  render();
}

function enableRosterDrag(card, id) {
  card.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    beginPointerDrag(card, { kind: "roster", id }, e);
  });
}

function enableSlotDrag(chip, idx) {
  chip.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".team-slot-clear")) return; // the ✕ button handles its own click
    e.preventDefault();
    beginPointerDrag(chip, { kind: "slot", idx }, e);
  });
}

