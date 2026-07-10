// Skill media rendering. The one owner of skill icon/animation lookup + DOM
// building — the same seam ui/sprite.js is for unit art, ui/board.js's
// classIconEl()/fillStatusRow() are for class/status icons. Every caller
// (party-picker detail, the battle log, the admin ⚔ Skills tab preview)
// routes through here so art changes never touch combat/UI logic elsewhere.
//
// Two independent lookup chains, both driven by the `skills` MASTER TABLE's
// `icon`/`animation` columns (riding every server read's `skills[]`
// json_agg — see CLAUDE.md's Phase 10.13 note):
//
// 1. ICON (`skill.icon`, public/icons/skills/, see that folder's README):
//      skill.icon || skill.slot || "default"  ->  /icons/skills/<base>.png
//    with the standard onerror-to-default.png loop-guarded fallback (the
//    classIconEl()/fillStatusRow() precedent in ui/board.js).
//
// 2. ANIMATION (`skill.animation`, public/anim/skills/, see that folder's
//    README) — the EXTENSION picks the renderer, no separate "kind" field:
//      *.svg -> a self-animating <img> (the animation is authored inside
//               the file; a plain <img src> plays it natively)
//      *.png -> a CSS sprite strip (a horizontal row of square frames,
//               played via steps(cols) — the same idiom ui/sprite.js uses
//               for unit sheets, just single-row)
//      anything else / falsy -> null (no animation)

/**
 * Build a skill's icon `<img>`.
 * @param {object} skill  any object carrying optional `icon`/`slot`/`name`
 *   (the shape every server read's `skills[]` entries carry)
 * @param {number} [size=16]
 * @returns {HTMLImageElement}
 */
export function skillIconEl(skill, size = 16) {
  const base = skill?.icon || skill?.slot || "default";
  const img = document.createElement("img");
  img.className = "skill-icon-img";
  img.alt = skill?.name || "";
  img.title = skill?.name || "";
  img.draggable = false;
  img.width = size;
  img.height = size;
  img.src = `/icons/skills/${base}.png`;
  img.onerror = () => {
    img.onerror = null; // guard: a missing default.png must not loop
    img.src = "/icons/skills/default.png";
  };
  return img;
}

/**
 * The same icon lookup as skillIconEl(), as an inline HTML string with an
 * inline onerror fallback — for callers building log lines as raw HTML
 * (src/core/battle.js's replaySkill) rather than DOM nodes.
 * @param {object} skill
 * @returns {string}
 */
export function skillIconHtml(skill) {
  const base = skill?.icon || skill?.slot || "default";
  return `<img class="log-skill-icon" src="/icons/skills/${base}.png" ` +
    `onerror="this.onerror=null;this.src='/icons/skills/default.png'">`;
}

/**
 * Build a skill's animation element, or null when it has none / the
 * filename's extension isn't a recognized renderer. See the header comment
 * for the extension-picks-the-renderer rule.
 * @param {string|null|undefined} file  a filename under public/anim/skills/
 * @returns {HTMLElement|null}
 */
export function skillAnimationEl(file) {
  if (!file) return null;

  if (file.endsWith(".svg")) {
    const img = document.createElement("img");
    img.className = "skill-anim-svg";
    img.src = `/anim/skills/${file}`;
    img.alt = "";
    img.draggable = false;
    return img;
  }

  if (file.endsWith(".png")) {
    const el = document.createElement("div");
    el.className = "skill-anim";
    // Load the sheet once to derive the frame count (square frames — cols
    // = width / height), then wire the CSS custom props ui/sprite.js's
    // .sprite rules already establish the idiom for.
    const probe = new Image();
    probe.onload = () => {
      const cols = Math.max(1, Math.round(probe.naturalWidth / probe.naturalHeight));
      el.style.setProperty("--cell", probe.naturalHeight + "px");
      el.style.setProperty("--sheet", `url("/anim/skills/${file}")`);
      el.style.setProperty("--cols", cols);
    };
    probe.onerror = () => {
      if (el.isConnected) el.remove(); // graceful: missing art, no broken box
    };
    probe.src = `/anim/skills/${file}`;
    return el;
  }

  return null;
}
