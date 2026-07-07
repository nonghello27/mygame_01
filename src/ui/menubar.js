// Menu bar: groups the control buttons into dropdowns (Playground,
// Activities, Battlefield) alongside a few direct top-level buttons.
// Pure DOM/CSS toggling — no game state, no imports from core/.

export function initMenubar() {
  const bar = document.getElementById("menubar");
  if (!bar) return;

  const groups = Array.from(bar.querySelectorAll(".menu-group"));

  function closeAll(except) {
    for (const g of groups) {
      if (g === except) continue;
      g.classList.remove("open");
      const trigger = g.querySelector(".menu-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    }
  }

  for (const group of groups) {
    const trigger = group.querySelector(".menu-trigger");
    if (!trigger) continue;
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const opening = !group.classList.contains("open");
      closeAll(opening ? group : null);
      group.classList.toggle("open", opening);
      trigger.setAttribute("aria-expanded", String(opening));
    });
  }

  // One document-level listener handles both cases: a trigger click stops
  // propagation above, so any click that reaches here is either a dropdown
  // button (its own listener already fired the action) or a click outside
  // the bar entirely — either way, close everything.
  document.addEventListener("click", closeAll);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });
}
