/** Resolve a promise after `ms` milliseconds. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read a CSS custom property from :root. */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Pick an HP-bar color from a 0..1 health ratio. */
export function hpColor(ratio) {
  if (ratio > 0.5) return cssVar("--hp-good");
  if (ratio > 0.22) return cssVar("--hp-mid");
  return cssVar("--hp-low");
}
