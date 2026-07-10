// Farm / Monster HQ panel: assign monsters to work or training jobs, watch
// the countdowns, collect what finished. "Collect" is still just a re-read —
// the server settles finished jobs on any authenticated read (lazy time),
// this panel merely shows what that read paid out — but Phase 10.10 makes
// the panel itself an ACTOR too: Send/Cancel are real choices sent to the
// server (`startJob`/`cancelActivity`), never computed here.
//
// Layout (Phase 10.10): a slots row on top — one box per `data.farmSlots`
// (the server's current concurrent-job cap, never a client constant), plus
// one extra decorative locked box — and a horizontally scrollable roster row
// below, both rendered inside the existing #farmList container. Slot boxes
// come in three flavors: occupied (a running job, with a Cancel-for-no-
// reward button), free (a drop target you can stage a monster + job into,
// then Send), and the trailing locked box. Cards render via board.js's
// shared unitCardEl(), the same widget ui/partyPicker.js and
// ui/monsterSetup.js host — display-only, gear-effective (Round 3) over
// deriveStats() folded through applyGearStats() at full HP, never sent
// anywhere.

import { loadFarm, startJob, cancelActivity } from "../services/content.js";
import { showProfile } from "./auth.js";
import { registerView } from "./views.js";
import { unitCardEl } from "./board.js";
import { deriveStats, applyGearStats } from "../../shared/rules/formulas.js";

const ATTR_LABEL = { str: "STR", agi: "AGI", vit: "VIT", int: "INT", dex: "DEX" };

// Same wording as ui/partyPicker.js's BUSY_LABEL (Phase 10.9) — copied
// rather than imported, since this panel doesn't otherwise depend on the
// party-picker module.
const BUSY_LABEL = {
  work: "Working",
  training: "Training",
  adventure: "On adventure",
  tournament: "In tournament",
  gvg: "In GVG",
};

const DRAG_THRESHOLD = 5; // px of movement before a pointerdown becomes a drag

let els = null;
let data = null; // last farm state: { trainer, jobs, monsters, active, farmSlots }
let timer = null;

// Staged picks for the FREE slots only, indexed by free-slot position (0 =
// the first free slot rendered, not an overall slot number) — a monster id
// or null. Session-local until Send actually posts it; a fresh apply()
// reconciles this against the new roster/active list every time.
let staged = [];
let drag = null; // { id, clone, target } — see beginPointerDrag()

export function initFarm() {
  els = {
    panel: document.getElementById("farmPanel"),
    list: document.getElementById("farmList"),
    msgs: document.getElementById("farmMsgs"),
    btn: document.getElementById("farmBtn"),
  };
  registerView("farm", { button: els.btn, el: els.panel, onShow: onShowFarm });
}

/** Entering this view refreshes AND (re)starts the countdown ticker — the
 *  view registry (ui/views.js) has no "leaving" hook, only onShow, so the
 *  ticker is guarded against being started twice rather than ever
 *  explicitly stopped; it costs nothing to keep ticking while hidden. */
async function onShowFarm() {
  await refresh();
  if (!timer) timer = setInterval(tick, 1000);
}

/** Re-read the farm (which settles finished jobs server-side) and re-render. */
async function refresh() {
  try {
    apply(await loadFarm());
  } catch (e) {
    els.msgs.innerHTML = "";
    pushMsg(`Could not load the farm: ${e.message}`, true);
  }
}

function apply(next) {
  data = next;
  showProfile(data.trainer); // gold/exp chips reflect what settlement paid
  els.msgs.innerHTML = "";
  for (const s of data.settled) pushMsg(collectedText(s));
  reconcileStaged();
  render();
}

function collectedText(s) {
  const who = monsterName(s.monsterId);
  return s.kind === "work"
    ? `✅ ${who} finished ${s.jobName}: +${s.gold} 🪙, +${s.trainerExp} ⭐`
    : `✅ ${who} finished ${s.jobName}: +${s.gain} ${ATTR_LABEL[s.attr] ?? s.attr}`;
}

function monsterName(id) {
  return data?.monsters.find((m) => m.id === id)?.name ?? "A monster";
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

// ---------- staged-slot bookkeeping ----------

function isBusy(m) {
  return m.busyUntil && new Date(m.busyUntil) > new Date();
}

/** A display lane for one roster monster: derived stats at full HP, alive —
 *  exactly what the battlefield card markup expects (ui/partyPicker.js's
 *  identical helper, Phase 10.9). Display-only, never sent anywhere. */
function laneView(m) {
  const d = applyGearStats(deriveStats(m.base, m.attrs), [...(m.equipment ?? []), ...(m.runes ?? [])]);
  return { ...m, ...d, hp: d.maxHp, alive: true };
}

function freeSlotCount() {
  return Math.max((data?.farmSlots ?? 0) - (data?.active.length ?? 0), 0);
}

/** Rebuild `staged` for the current free-slot count: drop any staged pick
 *  that's now busy or has left the roster (a Send that just landed, a job
 *  started elsewhere, or the roster simply changed underneath us), then
 *  COMPACT the survivors into the front of the array rather than
 *  preserving their old index — free slots carry no lane semantics, so
 *  losing exact position is fine, but index-preserving here would silently
 *  drop a still-valid staged pick any time an EARLIER slot's Send shrinks
 *  the free-slot count out from under a LATER one (e.g. stage monster A in
 *  free slot 0 and B in free slot 1, Send A: freeSlotCount drops 2 -> 1,
 *  and B's pick — sitting at index 1 — would otherwise vanish even though
 *  a free slot still exists for it). */
function reconcileStaged() {
  const n = freeSlotCount();
  const survivors = staged.filter((id) => {
    if (id == null) return false;
    const m = data.monsters.find((mm) => mm.id === id);
    return m && !isBusy(m);
  });
  staged = Array.from({ length: n }, (_, i) => survivors[i] ?? null);
}

/** No-drag fallback for touch/click users (same spirit as
 *  ui/partyPicker.js's detail-area placement path): a plain click on an
 *  available roster card places it into the first empty free slot. */
function placeInFirstFreeSlot(id) {
  const i = staged.indexOf(null);
  if (i === -1) return; // no free slot left client-side — the server would 409 anyway
  staged[i] = id;
  render();
}

// ---------- rendering ----------

function render() {
  els.list.innerHTML = "";
  els.list.append(slotsRow(), rosterRow());
}

function slotsRow() {
  const row = el("div", "farm-slots");
  // Occupied slots first, one per running job — never hidden, even if there
  // happen to be more of them than farmSlots (legacy overflow from before
  // the cap shipped).
  for (const a of data.active) row.appendChild(occupiedSlotEl(a));
  for (let i = 0; i < freeSlotCount(); i++) row.appendChild(freeSlotEl(i));
  row.appendChild(lockedSlotEl());
  return row;
}

function occupiedSlotEl(a) {
  const slot = el("div", "farm-slot occupied");
  const m = data.monsters.find((mm) => mm.id === a.monsterId);
  slot.appendChild(m ? unitCardEl(laneView(m), "") : el("div", "farm-slot-empty", `#${a.monsterId}`));
  const verb = a.kind === "work" ? "Working" : "Training";
  slot.appendChild(el("div", "farm-doing", `${verb}: ${a.jobName}`));
  slot.appendChild(countdownEl(a.endsAt));
  const cancelBtn = button("Cancel", "btn ghost farm-btn farm-cancel", async () => {
    if (!window.confirm("Cancel this job? The monster comes home with NO reward.")) return;
    cancelBtn.disabled = true;
    try {
      apply(await cancelActivity(a.id));
    } catch (e) {
      pushMsg(`Could not cancel: ${e.message}`, true);
      cancelBtn.disabled = false;
    }
  });
  slot.appendChild(cancelBtn);
  return slot;
}

function freeSlotEl(i) {
  const slot = el("div", "farm-slot free");
  slot.dataset.freeIndex = String(i);

  const id = staged[i];
  const m = id != null ? data.monsters.find((mm) => mm.id === id) : null;
  if (!m) {
    slot.appendChild(el("span", "farm-slot-empty", "Drop a monster here"));
    return slot;
  }

  const card = unitCardEl(laneView(m), "");
  const clear = button("✕", "team-slot-clear", (e) => {
    e.stopPropagation();
    staged[i] = null;
    render();
  });
  card.appendChild(clear);
  slot.appendChild(card);

  const select = buildJobSelect();
  const sendBtn = button("Send", "btn ghost farm-btn", async () => {
    sendBtn.disabled = true;
    try {
      apply(await startJob(m.id, select.value));
    } catch (e) {
      pushMsg(`Could not start the job: ${e.message}`, true);
      sendBtn.disabled = false;
    }
  });
  slot.append(select, sendBtn);
  return slot;
}

/** Purely decorative — one extra box beyond the server-reported farmSlots,
 *  a preview of "more slots in a future update". */
function lockedSlotEl() {
  const slot = el("div", "farm-slot locked");
  slot.append(el("span", null, "🔒 Locked"), el("small", "farm-hint", "more slots in a future update"));
  return slot;
}

function rosterRow() {
  const row = el("div", "farm-roster");
  for (const m of data.monsters) {
    const busy = isBusy(m);
    const stagedIndex = staged.indexOf(m.id);
    const card = unitCardEl(laneView(m), "");
    if (busy) {
      card.classList.add("busy");
      card.append(el("span", "team-card-busy-tag", `Busy: ${BUSY_LABEL[m.busyKind] ?? m.busyKind ?? "?"}`));
    } else if (stagedIndex !== -1) {
      card.classList.add("slotted");
      card.append(el("span", "team-card-badge", String(stagedIndex + 1)));
    } else {
      card.addEventListener("click", () => placeInFirstFreeSlot(m.id));
      enableRosterDrag(card, m.id);
    }
    row.appendChild(card);
  }
  return row;
}

/** Countdown that turns into a Collect button when the job is done. */
function countdownEl(endsAt) {
  const el0 = document.createElement("span");
  el0.className = "farm-count";
  el0.dataset.ends = endsAt;
  paintCountdown(el0);
  return el0;
}

function paintCountdown(el0) {
  const left = Math.ceil((new Date(el0.dataset.ends) - Date.now()) / 1000);
  if (left > 0) {
    el0.textContent = fmtLeft(left);
    return;
  }
  if (el0.querySelector("button")) return; // already showing Collect
  el0.textContent = "";
  const btn = document.createElement("button");
  btn.className = "btn ghost farm-btn";
  btn.textContent = "Collect";
  btn.addEventListener("click", refresh);
  el0.appendChild(btn);
}

function tick() {
  for (const el0 of els.list.querySelectorAll(".farm-count")) paintCountdown(el0);
}

function buildJobSelect() {
  const select = document.createElement("select");
  select.className = "farm-select";
  for (const kind of ["work", "training"]) {
    const group = document.createElement("optgroup");
    group.label = kind === "work" ? "Work — earn gold" : "Training — grow an attribute";
    for (const j of data.jobs.filter((job) => job.kind === kind)) {
      const opt = document.createElement("option");
      opt.value = j.id;
      opt.textContent = `${j.name} · ${fmtDur(j.durationS)} · ${rewardText(j)}`;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }
  return select;
}

function rewardText(j) {
  return j.kind === "work"
    ? `+${j.rewards.gold} 🪙 +${j.rewards.trainerExp} ⭐`
    : `+${j.rewards.gain} ${ATTR_LABEL[j.rewards.attr] ?? j.rewards.attr}`;
}

function fmtDur(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${+(s / 3600).toFixed(1)}h`;
}

function fmtLeft(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

// ---------- drag & drop (adapted from ui/partyPicker.js's beginPointerDrag,
// aimed at `.farm-slot.free` drop targets instead of party-picker's
// `.team-slot`s; the clone class + drop-target highlight class are the same
// globally-styled names so styles/team.css's rules apply here for free) ----

function enableRosterDrag(card, id) {
  card.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    beginPointerDrag(card, id, e);
  });
}

function beginPointerDrag(sourceEl, id, e) {
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
      drag = { id, clone, target: null };
      sourceEl.classList.add("dragging-src");
    }
    if (!started || !drag) return;
    clone.style.left = ev.clientX - dx + "px";
    clone.style.top = ev.clientY - dy + "px";
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const tSlot = under ? under.closest(".farm-slot.free") : null;
    if (drag.target && drag.target !== tSlot) drag.target.classList.remove("drop-target");
    if (tSlot) {
      tSlot.classList.add("drop-target");
      drag.target = tSlot;
    } else {
      drag.target = null;
    }
  }

  // Shared teardown for both a normal drop and an interrupted stream —
  // never leaves the pointermove listener, the clone, or a drop-target
  // highlight behind either way.
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
    if (wasStarted && targetSlot) {
      staged[Number(targetSlot.dataset.freeIndex)] = id;
      render();
    }
    // else: a plain click — the element's own click handler runs separately
    drag = null;
  }

  // A touch scroll or other browser gesture interrupts the pointer stream
  // with `pointercancel`, not `pointerup` — tear down exactly like onUp
  // but WITHOUT applying a drop (a cancelled drag changes nothing).
  function onCancel() {
    cleanup();
    drag = null;
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
  window.addEventListener("pointercancel", onCancel, { once: true });
}
