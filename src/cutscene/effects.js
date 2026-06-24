// Attack effect graphics, keyed by the `fx` type in data/classes.js. Each
// returns an <svg> string positioned center-stage; cutscene.css animates the
// tagged group/path (fx-slash, fx-arrows, fx-lance, fx-cleave, fx-magic,
// fx-charge) along the shared cutscene timeline.
//
// To add an effect: add a `case` here and a matching .fx-* animation in
// styles/cutscene.css, then reference its key from CLASS_META.fx.

export function effectSVG(fx, accent) {
  const arrow = (t) =>
    `<g transform="${t}"><polygon points="120,138 196,133 196,143" fill="#fff"/><polygon points="196,126 228,138 196,150" fill="${accent}"/></g>`;

  switch (fx) {
    case "slash":
      return `<svg viewBox="0 0 400 280">
        <path class="fx-slash" d="M50 232 Q200 24 360 210" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round"/>
        <path class="fx-slash" d="M60 210 Q200 60 350 198" fill="none" stroke="${accent}" stroke-width="6" stroke-linecap="round"/></svg>`;
    case "arrows":
      return `<svg viewBox="0 0 400 280"><g class="fx-arrows">${arrow("translate(0,-34)")}${arrow("translate(18,8)")}${arrow("translate(-12,46)")}</g></svg>`;
    case "lance":
      return `<svg viewBox="0 0 400 280"><polygon class="fx-lance" points="70,142 300,128 312,140 300,152" fill="#fff" stroke="${accent}" stroke-width="3"/></svg>`;
    case "cleave":
      return `<svg viewBox="0 0 400 280"><g class="fx-cleave">
        <path d="M90 64 L322 214" stroke="#fff" stroke-width="14" stroke-linecap="round"/>
        <path d="M322 64 L90 214" stroke="${accent}" stroke-width="14" stroke-linecap="round"/></g></svg>`;
    case "magic":
      return `<svg viewBox="0 0 400 280"><g class="fx-magic">
        <circle cx="200" cy="140" r="26" fill="${accent}"/>
        <circle cx="200" cy="140" r="48" fill="none" stroke="${accent}" stroke-width="6" opacity="0.7"/>
        <circle cx="200" cy="140" r="72" fill="none" stroke="${accent}" stroke-width="3" opacity="0.4"/></g></svg>`;
    case "charge":
      return `<svg viewBox="0 0 400 280"><g class="fx-charge">
        <rect x="40" y="116" width="130" height="8" rx="4" fill="#fff"/>
        <rect x="64" y="138" width="170" height="6" rx="3" fill="${accent}"/>
        <rect x="28" y="160" width="110" height="8" rx="4" fill="#fff" opacity="0.8"/>
        <rect x="84" y="98" width="96" height="5" rx="3" fill="${accent}" opacity="0.7"/></g></svg>`;
    default:
      return "";
  }
}
