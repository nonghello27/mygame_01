// Shared 3-lane party picker (Phase 10.9, extracted from ui/team.js): the
// Setup Team panel's slots-over-roster widget (Phase 10.5/10.8), pulled out
// so the Adventure panel can host the identical drag-and-drop experience.
// Pure display + local choice state — it never talks to the server; hosts
// read getSlots() and send the ids as their CHOICE (CLAUDE.md §1.1).
//
// The roster row below the slots is the remaining POOL, not the whole
// roster (Phase 10.14): a monster placed in a lane is removed from the pool
// row entirely and exists only as that lane's card, so the pool always
// shows exactly what's still available to pick from.
//
// Cards render via board.js's unitCardEl over GEAR-EFFECTIVE stats —
// deriveStats(base, attrs) folded through applyGearStats() against the
// monster's server-state equipment[]/runes[] (the SAME pure derivation +
// perm_stat math the server freezes into snapshots/applies at battle_start;
// shared/ is importable by src/ by design); display-only, never sent anywhere.
//
// Drag-and-drop adapts ui/dragdrop.js's pointer-event clone pattern (works
// on touch: a small movement threshold before a drag actually starts keeps a
// plain tap a click). CSS classes (`team-*`) are unchanged and shared
// globally via styles/team.css — see that file's header comment.

import { unitCardEl } from "./board.js";
import { skillIconEl } from "./skillMedia.js";
import { deriveStats, powerScore, applyGearStats } from "../../shared/rules/formulas.js";

const BUSY_LABEL = {
  work: "Working",
  training: "Training",
  adventure: "On adventure",
  tournament: "In tournament",
  gvg: "In GVG",
};
const PARTY_SIZE = 3;
const DRAG_THRESHOLD = 5; // px of movement before a pointerdown becomes a drag

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

/** Monsters have no level of their own — this is the same powerScore()
 *  number the card's rank block shows (Phase 10.9), gear-effective (Round 3)
 *  so the sort order matches the number actually printed on the card,
 *  display-only, never sent anywhere. */
function powerOf(m) {
  const d = applyGearStats(deriveStats(m.base, m.attrs), [...(m.equipment ?? []), ...(m.runes ?? [])]);
  return powerScore(d);
}

function isBusy(m) {
  return m.busyUntil && new Date(m.busyUntil) > new Date();
}

/** A display lane for one roster monster: derived stats at full HP, alive,
 *  gear-effective off the monster's equipped equipment AND socketed runes —
 *  exactly what the battlefield card markup expects. Display-only. */
function laneView(m) {
  const d = applyGearStats(deriveStats(m.base, m.attrs), [...(m.equipment ?? []), ...(m.runes ?? [])]);
  return { ...m, ...d, hp: d.maxHp, alive: true };
}

/** Assign `id` into `slots[slotIdx]`, first clearing any OTHER slot that
 *  already held it (no duplicates). Returns a new array. */
function assignToSlot(current, slotIdx, id) {
  const next = current.map((v) => (v === id ? null : v));
  next[slotIdx] = id;
  return next;
}

function normalizeSlots(slots) {
  const out = [null, null, null];
  for (let i = 0; i < PARTY_SIZE; i++) out[i] = slots?.[i] ?? null;
  return out;
}

/**
 * Shared 3-lane party picker (Phase 10.9): the Setup Team panel's slots-
 * over-roster widget (Phase 10.5/10.8), extracted so the Adventure panel
 * can host the identical experience. Pure display + local choice state —
 * it never talks to the server; hosts read getSlots() and send ids as
 * their CHOICE (CLAUDE.md §1.1).
 * @param {{monsters: object[], initialSlots?: (number|null)[],
 *          onChange?: (slots:(number|null)[]) => void}} opts
 * @returns {{el: HTMLElement, getSlots: () => (number|null)[],
 *            setSlots: (slots:(number|null)[]) => void,
 *            setMonsters: (monsters: object[]) => void}}
 */
export function createPartyPicker({ monsters, initialSlots, onChange } = {}) {
  let roster = monsters || [];
  let slots = normalizeSlots(initialSlots);
  let sortKey = "order";      // 'order' | 'name' | 'power'
  let sortDir = "asc";        // 'asc' | 'desc'
  let detailId = null;        // monster id shown in the detail area, or null
  let drag = null;            // { source, clone, target } — see beginPointerDrag()

  const container = el("div", "party-picker");

  function getSlots() {
    return [...slots];
  }

  function monsterById(id) {
    return roster?.find((m) => m.id === id) ?? null;
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

  /** Rebuild the container's contents from current state. Sort/detail-only
   *  changes call this directly; anything that actually changes a slot pick
   *  goes through renderAndNotify() below instead. */
  function render() {
    container.innerHTML = "";
    if (!roster) return;
    container.append(slotsRow(), sortBar(), rosterRow());
    const detail = detailArea();
    if (detail) container.append(detail);
  }

  /** render() + tell the host the slot picks changed. Kept separate from
   *  render() itself so the picker's OWN initial construction (below) can
   *  render without firing onChange before the factory call has even
   *  returned — a host that assigns `const picker = createPartyPicker(...)`
   *  and reads `picker` from inside its onChange would otherwise see it
   *  still undefined on that very first call. */
  function renderAndNotify() {
    render();
    onChange?.(getSlots());
  }

  /** Open (or re-focus) the detail area for one roster monster. */
  function showDetail(id) {
    detailId = id;
    render();
  }

  // ---------- rendering ----------

  /** Renders the 3 lane columns RIGHT-to-LEFT in data order (Lane 3, Lane 2,
   *  Lane 1 left→right) so the row visually matches the battlefield, where
   *  army A renders back→front with lane 1 (the front, first to fight)
   *  rightmost, nearest the clash zone. `slots` stays index 0 = lane 1 =
   *  front throughout — only the DOM append order flips, never the data. */
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
            renderAndNotify();
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

  /** The remaining pool row (Phase 10.14): a monster already placed in a
   *  lane is skipped entirely here — it lives only in slotsRow() above — so
   *  this always renders exactly the monsters still available to pick. */
  function rosterRow() {
    const row = el("div", "team-roster");
    for (const m of sortedRoster()) {
      if (slots.indexOf(m.id) !== -1) continue; // already placed in a lane — lives only in the slots row (Phase 10.14)
      const busy = isBusy(m);
      const card = unitCardEl(laneView(m), "");
      if (busy) card.classList.add("busy");
      if (busy) {
        card.append(el("span", "team-card-busy-tag", `Busy: ${BUSY_LABEL[m.busyKind] ?? m.busyKind ?? "?"}`));
      }
      // Busy cards get no click/drag — tap-to-place is DELETED (10.8): a
      // click now opens the detail area, which is where lane placement/
      // removal moves to as the no-drag path (touch users: tap = detail,
      // place from there).
      if (!busy) {
        card.addEventListener("click", () => showDetail(m.id));
        enableRosterDrag(card, m.id);
      }
      row.appendChild(card);
    }
    return row;
  }

  /** The click-for-detail area (Phase 10.8) — null when nothing is selected
   *  or the selected monster left the roster. Also the no-drag placement
   *  path (touch: tap a card = detail, place/remove from here) that
   *  replaces 10.5's tap-to-place-in-first-empty-slot behavior. */
  function detailArea() {
    if (detailId == null) return null;
    const m = monsterById(detailId);
    if (!m) return null;

    const d = applyGearStats(deriveStats(m.base, m.attrs), [...(m.equipment ?? []), ...(m.runes ?? [])]);
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
        const row = el("div", "team-detail-skill");
        row.append(skillIconEl(sk, 16), el("span", null, `${sk.name} (Lv ${sk.level})`));
        skillsBox.append(row);
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
        renderAndNotify();
      });
      btn.disabled = busy;
      actions.append(btn);
    }
    if (slotted) {
      actions.append(button("Remove from team", "btn ghost", () => {
        slots = slots.map((v, idx) => (idx === slotIdx ? null : v));
        renderAndNotify();
      }));
    }
    box.append(actions);

    return box;
  }

  // ---------- drag & drop (adapted from ui/dragdrop.js's pointer-event pattern) ----------

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
      if (wasStarted) applyDrop(source, targetSlot ? Number(targetSlot.dataset.slot) : null);
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

  function applyDrop(source, targetSlotIdx) {
    if (source.kind === "roster") {
      if (targetSlotIdx == null) return; // dropped outside a slot: no-op
      slots = assignToSlot(slots, targetSlotIdx, source.id);
      renderAndNotify();
      return;
    }
    // source.kind === "slot"
    if (targetSlotIdx == null) {
      slots = slots.map((v, i) => (i === source.idx ? null : v));
      renderAndNotify();
      return;
    }
    if (targetSlotIdx === source.idx) return;
    const next = [...slots];
    [next[source.idx], next[targetSlotIdx]] = [next[targetSlotIdx], next[source.idx]];
    slots = next;
    renderAndNotify();
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

  // ---------- public API ----------

  /** Host-driven: replace the slot picks (e.g. team.js's Reset). Notifies
   *  like any other slot mutation, since the host still wants its own
   *  dependent UI (a Save button's disabled state) to stay in sync. */
  function setSlots(next) {
    slots = normalizeSlots(next);
    if (detailId != null && !monsterById(detailId)) detailId = null;
    renderAndNotify();
  }

  /** Host-driven: swap the roster in place (e.g. a re-read finished). Slot
   *  picks are left as-is — call setSlots() too if they need reconciling
   *  against the new roster. */
  function setMonsters(next) {
    roster = next;
    if (detailId != null && !monsterById(detailId)) detailId = null;
    render();
  }

  // Initial paint only — deliberately NOT renderAndNotify(): the factory
  // call below hasn't returned yet, so a host that captures the returned
  // instance in a variable and reads it from inside onChange would see that
  // variable still unassigned on this very first call.
  render();

  return { el: container, getSlots, setSlots, setMonsters };
}
