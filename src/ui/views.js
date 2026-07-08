// View registry (Phase 10.7) — the app shows ONE view at a time: the
// battlefield ("playground") or exactly one panel. Panels register here
// instead of wiring their own show/hide toggle; entering any view hides
// every other registered view. Pure DOM orchestration — no game state, no
// fetches of its own (each view's `onShow` does its own refresh).

const views = new Map(); // name -> { button, el, onShow }

/**
 * Register a view. `button` (optional) is wired to show the view on click;
 * `el` is the view's root element; `onShow` (optional, may be async) runs
 * every time the view is shown — panels pass their refresh-on-open here.
 * Clicking an already-visible view's button just runs onShow again (a
 * refresh); you leave a view by entering another, never by "closing".
 */
export function registerView(name, { button, el, onShow } = {}) {
  views.set(name, { button, el, onShow });
  button?.addEventListener("click", () => {
    showView(name); // fire-and-forget — click handlers don't await
  });
}

/** Show `name`, hide every other registered view. Runs onShow. */
export async function showView(name) {
  const target = views.get(name);
  if (!target) {
    console.warn(`showView: unknown view "${name}"`);
    return;
  }
  for (const entry of views.values()) {
    entry.el.hidden = entry !== target;
  }
  await target.onShow?.();
}
