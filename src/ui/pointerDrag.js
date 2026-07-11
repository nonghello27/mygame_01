// Shared pointer-drag engine (Phase 10.15), extracted from the three near-
// identical implementations that used to live in ui/partyPicker.js,
// ui/farm.js and ui/dragdrop.js: a clone follows the pointer, an
// `elementFromPoint` probe under it drives a `.drop-target` highlight, and
// teardown is symmetric across every exit path. Call `beginPointerDrag(e,
// opts)` straight from a `pointerdown` handler; it owns the rest of the
// gesture (window-level `pointermove`/`pointerup`/`pointercancel`) itself.
//
// THE INTERACTION MODEL — "hold to pick up, swipe to scroll" (playtest
// feedback: cards are big, `touch-action:none` + a 5px drag threshold meant
// a finger landing anywhere on a card got captured, with no room left to
// scroll a row or the page on a touch screen):
//
//   - Mouse (`pointerType:"mouse"`): unchanged feel. `preventDefault()`
//     fires on the pointerdown itself (safe — a mouse gesture never wants
//     to fall through to a native scroll), and the drag starts once the
//     pointer has moved `DRAG_THRESHOLD` px; a plain click stays a click.
//   - Touch/pen: the pointerdown is left ALONE (no preventDefault — the
//     browser must stay free to turn the gesture into a scroll right up
//     until the hold completes; cards' CSS `touch-action` is `pan-x pan-y`
//     for exactly this reason, Phase 10.15). A drag only lifts after
//     `HOLD_MS` of the finger resting within `HOLD_SLOP` px of where it
//     landed. Moving past the slop before the hold timer fires cancels the
//     pending drag outright and does nothing further — the browser wins
//     the gesture and scrolls, exactly as if we were never here. A
//     `pointercancel` (the browser itself deciding, independently of our
//     own slop check, that this is a pan) tears down the same way.
//     Once the hold completes, the card "lifts": a haptic tick
//     (`navigator.vibrate?.(15)`), the drag clone appears, and — because
//     `touch-action` can't be changed mid-gesture — a window-level
//     NON-PASSIVE `touchmove` listener starts calling `preventDefault()`
//     for the rest of the gesture. That's the standard way to keep a
//     lifted drag from being hijacked as a scroll once it's already
//     under way.
//
// API: beginPointerDrag(e, { sourceEl, findTarget, onDrop, cloneClasses }).
//   - sourceEl: the element being dragged (cloned for the floating clone,
//     marked `.dragging-src` for the duration).
//   - findTarget(elementUnderPoint): (Element) => Element|null — given
//     whatever `document.elementFromPoint()` returns under the pointer,
//     return the valid drop target (or null). Callers do their own
//     `.closest()`/validity checks here (e.g. "same army, not the source
//     card itself").
//   - onDrop(targetEl|null): called ONLY when a drag that actually STARTED
//     ends via `pointerup` — null still means "released over nothing". The
//     target is probed once at LIFT itself (at the start point, not just on
//     every subsequent pointermove) as well as on every move after that, so
//     a hold-then-release-WITHOUT-moving (a touch drag that lifts via the
//     hold timer with the finger never leaving its start point — very
//     common while deciding) still resolves against whatever was under the
//     finger at that point, rather than defaulting to null: a slot card
//     lifted and dropped in place lands back on its own slot (a no-op, not
//     "removed"), a roster/battlefield card with nothing valid under it
//     still resolves to null exactly as before. A tap that never crosses
//     the threshold/hold never calls this at all; the element's own `click`
//     handler runs for that case, same as before this module existed.
//   - cloneClasses: array of extra classes for the floating clone (callers
//     each style their own clone globally — `team-drag-clone` for the
//     party-picker/farm family, `drag-clone`/`army-<side>` for the
//     battlefield — this module adds no classes of its own).

const DRAG_THRESHOLD = 5; // px of movement before a MOUSE pointerdown becomes a drag
const HOLD_MS = 300;      // TOUCH/PEN: hold this long before a drag lifts
const HOLD_SLOP = 10;     // TOUCH/PEN: max finger movement allowed while the hold is pending

export function beginPointerDrag(e, { sourceEl, findTarget, onDrop, cloneClasses = [] }) {
  const isHold = e.pointerType === "touch" || e.pointerType === "pen";
  if (!isHold) e.preventDefault(); // mouse only — see header

  const startX = e.clientX;
  const startY = e.clientY;
  let started = false;
  let clone = null;
  let dx = 0, dy = 0;
  let target = null;
  let holdTimer = null;

  function clearHold() {
    if (holdTimer != null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  // A non-passive touchmove listener is the only way left to stop the
  // browser from turning an already-lifted drag into a scroll — touch-action
  // can't be flipped mid-gesture. Only wired up once a touch/pen drag has
  // actually started (lift()).
  function preventTouchScroll(ev) {
    ev.preventDefault();
  }

  // The elementFromPoint -> findTarget -> .drop-target swap, factored out so
  // lift() can run it once at the LIFT point (not just on subsequent
  // pointermoves — see the release-in-place fix below) as well as every
  // pointermove after that. Safe to probe right through the floating clone:
  // both `.team-drag-clone` (styles/team.css) and `.drag-clone`
  // (styles/board.css) are `pointer-events:none`, so `elementFromPoint`
  // always sees the real card/slot underneath it, never the clone itself.
  function probeTarget(x, y) {
    const under = document.elementFromPoint(x, y);
    const t = under ? findTarget(under) : null;
    if (target && target !== t) target.classList.remove("drop-target");
    if (t) {
      t.classList.add("drop-target");
      target = t;
    } else {
      target = null;
    }
  }

  function lift() {
    started = true;
    const rect = sourceEl.getBoundingClientRect();
    clone = sourceEl.cloneNode(true);
    for (const c of cloneClasses) clone.classList.add(c);
    clone.style.width = rect.width + "px";
    clone.style.left = rect.left + "px";
    clone.style.top = rect.top + "px";
    document.body.appendChild(clone);
    dx = startX - rect.left;
    dy = startY - rect.top;
    sourceEl.classList.add("dragging-src");
    if (isHold) {
      navigator.vibrate?.(15);
      window.addEventListener("touchmove", preventTouchScroll, { passive: false });
    }
    // Probe once at the lift point itself: a touch drag that lifts via the
    // hold timer (no movement yet) would otherwise have no target at all
    // until the next pointermove, so a press-and-hold-then-release-in-place
    // (very common while deciding) would read as "dropped on nothing" and,
    // for a slotted card, silently clear that lane slot. Probing here means
    // a release-in-place instead drops onto whatever is under the finger —
    // a slot card drops onto its own slot (a no-op), a card with no valid
    // target under it still resolves to null exactly as before.
    probeTarget(startX, startY);
  }

  function onMove(ev) {
    if (!started) {
      if (isHold) {
        // Touch/pen never starts a drag from movement alone — only the hold
        // timer (armed below) calls lift(). Moving past the slop before it
        // fires cancels the pending drag and lets the browser scroll.
        if (Math.abs(ev.clientX - startX) > HOLD_SLOP || Math.abs(ev.clientY - startY) > HOLD_SLOP) {
          clearHold();
          cleanup();
        }
        return;
      }
      if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
      lift();
    }
    if (!started) return;
    clone.style.left = ev.clientX - dx + "px";
    clone.style.top = ev.clientY - dy + "px";
    probeTarget(ev.clientX, ev.clientY);
  }

  // Shared teardown for every exit path — a normal drop, a plain tap/click,
  // a pre-hold slop cancellation, or an interrupted stream (pointercancel:
  // the browser claimed the gesture, scroll won) — never leaves the hold
  // timer, the touchmove listener, the clone, or a drop-target highlight
  // behind either way.
  function cleanup() {
    clearHold();
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("touchmove", preventTouchScroll);
    sourceEl.classList.remove("dragging-src");
    if (target) target.classList.remove("drop-target");
    if (clone) clone.remove();
  }

  function onUp() {
    const wasStarted = started;
    const droppedOn = target;
    cleanup();
    if (wasStarted) onDrop(droppedOn);
    // else: a plain tap/click — the element's own click handler runs separately
  }

  function onCancel() {
    cleanup();
  }

  if (isHold) holdTimer = setTimeout(lift, HOLD_MS);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
  window.addEventListener("pointercancel", onCancel, { once: true });
}
