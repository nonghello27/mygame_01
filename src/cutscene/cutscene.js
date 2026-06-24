// Builds and plays one full-screen attack cutscene (letterbox bands, dueling
// portraits, windup, attack effect, impact flash + damage). Resolves when the
// timeline finishes or the player skips (tap / space / esc).

import { accentFor, CUTSCENE } from "../config.js";
import { CLASS_META } from "../data/classes.js";
import { portraitSVG } from "./portraits.js";
import { effectSVG } from "./effects.js";
import { hpColor } from "../utils/helpers.js";

let overlay;

export function initCutscene() {
  overlay = document.getElementById("cutscene");
}

/**
 * Play the attack animation for one strike.
 * @returns {Promise<void>} resolves when the cutscene ends or is skipped.
 */
export function playCutscene(att, attSide, def, defSide, dmg, before, after, maxHp) {
  return new Promise((resolve) => {
    const attLeft = attSide === "a"; // faction A stages left, B stages right
    const aAcc = accentFor(attSide);
    const dAcc = accentFor(defSide);
    const beforeR = before / maxHp;
    const afterR = after / maxHp;
    const meta = CLASS_META[att.cls] || {};
    const attackName = meta.attackName || "Strike";

    overlay.innerHTML = `
      <div class="cs-band top">
        <div class="cs-info attacker ${attSide}">
          <div class="cs-faction">${attSide === "a" ? "YOUR UNIT" : "ENEMY"}</div>
          <div class="cs-uname">${att.name}<span class="cs-ucls"> · ${att.cls}</span></div>
          <div class="cs-atk-name">${attackName}</div>
        </div>
      </div>
      <div class="cs-stage">
        <div class="cs-speedlines"></div>
        <div class="cs-portrait ${attLeft ? "left" : "right"} attacker" style="--accent:${aAcc}">
          <div class="port-inner ${attLeft ? "atk-r" : "atk-l"}">${portraitSVG(att, aAcc)}</div>
        </div>
        <div class="cs-portrait ${attLeft ? "right" : "left"} defender" style="--accent:${dAcc}">
          <div class="port-inner ${attLeft ? "recoil-r" : "recoil-l"}">${portraitSVG(def, dAcc)}</div>
        </div>
        <div class="cs-fx ${attLeft ? "dir-lr" : "dir-rl"}">${effectSVG(meta.fx, aAcc)}</div>
        <div class="cs-flash"></div>
        <div class="cs-damage">-${dmg}</div>
      </div>
      <div class="cs-band bottom">
        <div class="cs-info defender ${defSide}">
          <div class="cs-faction">${defSide === "a" ? "YOUR UNIT" : "ENEMY"}</div>
          <div class="cs-uname">${def.name}<span class="cs-ucls"> · ${def.cls}</span></div>
          <div class="cs-hpbar"><div class="cs-hpfill" style="width:${beforeR * 100}%;background:${hpColor(beforeR)}"></div></div>
        </div>
        <div class="cs-skip">tap or press space to skip</div>
      </div>`;

    overlay.classList.add("show");
    overlay.setAttribute("aria-hidden", "false");

    const dFill = overlay.querySelector(".cs-hpfill");
    const tImpact = setTimeout(() => {
      if (dFill) { dFill.style.width = afterR * 100 + "%"; dFill.style.background = hpColor(afterR); }
    }, CUTSCENE.impact);

    let done = false;
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(tImpact);
      clearTimeout(tEnd);
      overlay.classList.remove("show");
      overlay.setAttribute("aria-hidden", "true");
      overlay.removeEventListener("pointerdown", finish);
      window.removeEventListener("keydown", keyFn);
      resolve();
    }
    const tEnd = setTimeout(finish, CUTSCENE.total);
    function keyFn(e) {
      if (["Space", "Escape", "Enter"].includes(e.code)) { e.preventDefault(); finish(); }
    }
    overlay.addEventListener("pointerdown", finish);
    window.addEventListener("keydown", keyFn);
  });
}
