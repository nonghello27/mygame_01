// Procedural SVG bust portraits, keyed by unit class. Each returns an <svg>
// string. Elements tagged class="eye" are animated (glow) by cutscene.css.
//
// To add a class: add a `case` returning an <svg viewBox="0 0 200 230">.
// `accent` is the faction color used for highlights/eyes.

export function portraitSVG(unit, accent) {
  switch (unit.cls) {
    case "Knight":
      return `<svg viewBox="0 0 200 230" xmlns="http://www.w3.org/2000/svg">
        <path d="M22 230 Q30 150 75 152 L125 152 Q170 150 178 230 Z" fill="#283340"/>
        <path d="M70 150 L70 120 L130 120 L130 150 Z" fill="#39444f"/>
        <path d="M58 96 Q58 44 100 44 Q142 44 142 96 L142 122 Q142 152 100 152 Q58 152 58 122 Z" fill="#465463" stroke="#5d6f81" stroke-width="2"/>
        <path d="M100 14 Q126 26 116 60 L100 56 L84 60 Q74 26 100 14 Z" fill="${accent}" opacity="0.9"/>
        <rect x="95" y="78" width="10" height="58" rx="3" fill="#0c1117"/>
        <rect x="70" y="92" width="60" height="13" rx="4" fill="#0c1117"/>
        <circle class="eye" cx="86" cy="98" r="4.5" fill="${accent}"/>
        <circle class="eye" cx="114" cy="98" r="4.5" fill="${accent}"/>
        <path d="M58 110 L46 124 M142 110 L154 124" stroke="#5d6f81" stroke-width="4" stroke-linecap="round"/></svg>`;
    case "Archer":
      return `<svg viewBox="0 0 200 230" xmlns="http://www.w3.org/2000/svg">
        <path d="M18 230 Q34 150 100 150 Q166 150 182 230 Z" fill="#242f3f"/>
        <path d="M52 112 Q42 38 100 32 Q158 38 148 112 Q148 152 100 154 Q52 152 52 112 Z" fill="#2f3a4e" stroke="#3d4a60" stroke-width="2"/>
        <path d="M100 32 L116 10 L98 28 Z" fill="#3d4a60"/>
        <ellipse cx="100" cy="106" rx="33" ry="38" fill="#0b0f16"/>
        <path class="eye" d="M74 102 L96 96 L94 108 Z" fill="${accent}"/>
        <path class="eye" d="M126 102 L104 96 L106 108 Z" fill="${accent}"/>
        <path d="M150 70 Q180 110 150 150" fill="none" stroke="#6b7a8f" stroke-width="4"/>
        <line x1="150" y1="70" x2="150" y2="150" stroke="#46525f" stroke-width="2"/></svg>`;
    case "Lancer":
      return `<svg viewBox="0 0 200 230" xmlns="http://www.w3.org/2000/svg">
        <path d="M22 230 Q30 152 78 152 L122 152 Q170 152 178 230 Z" fill="#283340"/>
        <path d="M72 152 L100 26 L128 152 Z" fill="#46535f" stroke="#5d6f81" stroke-width="2"/>
        <path d="M100 26 L100 6" stroke="${accent}" stroke-width="4" stroke-linecap="round"/>
        <rect x="95" y="78" width="10" height="60" rx="3" fill="#0c1117"/>
        <circle class="eye" cx="100" cy="92" r="4.5" fill="${accent}"/>
        <circle class="eye" cx="100" cy="112" r="3.5" fill="${accent}" opacity="0.8"/>
        <path d="M72 150 L52 150 M128 150 L148 150" stroke="#5d6f81" stroke-width="5" stroke-linecap="round"/></svg>`;
    case "Raider":
      return `<svg viewBox="0 0 200 230" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 230 Q30 150 100 150 Q170 150 184 230 Z" fill="#36242c"/>
        <path d="M60 96 Q34 64 42 30 Q66 52 74 96 Z" fill="${accent}"/>
        <path d="M140 96 Q166 64 158 30 Q134 52 126 96 Z" fill="${accent}"/>
        <path d="M58 100 Q58 50 100 50 Q142 50 142 100 L142 124 Q142 152 100 152 Q58 152 58 124 Z" fill="#4a3942" stroke="#624a55" stroke-width="2"/>
        <path class="eye" d="M74 98 L98 104 L96 114 L76 110 Z" fill="${accent}"/>
        <path class="eye" d="M126 98 L102 104 L104 114 L124 110 Z" fill="${accent}"/>
        <path d="M80 130 L120 130 L112 140 L88 140 Z" fill="#1b1216"/>
        <rect x="86" y="132" width="5" height="8" fill="#d9d2cf"/>
        <rect x="96" y="132" width="5" height="8" fill="#d9d2cf"/>
        <rect x="106" y="132" width="5" height="8" fill="#d9d2cf"/></svg>`;
    case "Shaman":
      return `<svg viewBox="0 0 200 230" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 230 Q32 148 100 148 Q168 148 186 230 Z" fill="#2c2436"/>
        <ellipse cx="100" cy="104" rx="46" ry="56" fill="#3a2f48" stroke="#4d3f60" stroke-width="2"/>
        <path d="M100 48 L100 158 M70 70 L130 70 M66 130 L134 130" stroke="#5b4a72" stroke-width="3" opacity="0.7"/>
        <circle class="eye" cx="100" cy="80" r="8" fill="${accent}"/>
        <path class="eye" d="M72 110 q14 -10 28 0 q-14 8 -28 0z" fill="${accent}" opacity="0.85"/>
        <path class="eye" d="M100 110 q14 -10 28 0 q-14 8 -28 0z" fill="${accent}" opacity="0.85"/>
        <path d="M84 138 Q100 150 116 138" fill="none" stroke="#1c1626" stroke-width="4"/>
        <circle cx="60" cy="40" r="5" fill="${accent}" opacity="0.7"/>
        <circle cx="140" cy="40" r="5" fill="${accent}" opacity="0.7"/></svg>`;
    case "Warbeast":
      return `<svg viewBox="0 0 200 230" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 230 Q30 146 100 146 Q170 146 190 230 Z" fill="#33231a"/>
        <ellipse cx="100" cy="98" rx="54" ry="50" fill="#4a3526" stroke="#5f4632" stroke-width="2"/>
        <path d="M62 64 Q70 44 84 56 M138 64 Q130 44 116 56" stroke="#5f4632" stroke-width="6" fill="none" stroke-linecap="round"/>
        <rect x="72" y="104" width="56" height="44" rx="16" fill="#3a2920"/>
        <ellipse cx="86" cy="126" rx="5" ry="7" fill="#15100c"/>
        <ellipse cx="114" cy="126" rx="5" ry="7" fill="#15100c"/>
        <path d="M80 148 Q74 172 64 168 Q72 158 74 146 Z" fill="#e7dccb"/>
        <path d="M120 148 Q126 172 136 168 Q128 158 126 146 Z" fill="#e7dccb"/>
        <path class="eye" d="M74 92 L92 88 L90 98 L76 100 Z" fill="${accent}"/>
        <path class="eye" d="M126 92 L108 88 L110 98 L124 100 Z" fill="${accent}"/></svg>`;
    default:
      return `<svg viewBox="0 0 200 230"><circle cx="100" cy="100" r="60" fill="#3a4654"/>
        <circle class="eye" cx="82" cy="95" r="5" fill="${accent}"/>
        <circle class="eye" cx="118" cy="95" r="5" fill="${accent}"/></svg>`;
  }
}
