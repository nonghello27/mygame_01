// Trainer panel (Phase 6 step 5): expertise choice + the 2 trainer-skill
// learn slots (GAME_DESIGN §2). Pure presentation over /api/progression and
// /api/trainer-skills — every number (exp, unlock threshold, skill effects)
// comes from the server; this module only renders it and posts choices.
// Switching to a DIFFERENT expertise wipes both learn slots server-side
// (GAME_DESIGN §2, deliberate cost) — this panel warns with an inline
// two-step confirm before posting that choice.

import { fetchProgression, chooseExpertise, learnTrainerSkill } from "../services/content.js";
import { TRAINER_SKILL_SLOTS } from "../../shared/rules/progression.js";
import { registerView } from "./views.js";

let els = null;
let data = null;          // last progression state from the server
let pendingSwitch = null; // expertiseId awaiting a second confirm click, or null

export function initTrainer() {
  els = {
    btn: document.getElementById("trainerBtn"),
    panel: document.getElementById("trainerPanel"),
    msgs: document.getElementById("trainerMsgs"),
    body: document.getElementById("trainerBody"),
  };
  registerView("trainer", { button: els.btn, el: els.panel, onShow: refresh });
}

async function refresh() {
  els.msgs.innerHTML = "";
  try {
    apply(await fetchProgression());
  } catch (e) {
    pushMsg(`Could not load progression: ${e.message}`, true);
  }
}

function apply(next) {
  data = next;
  pendingSwitch = null;
  render();
}

/** Run a mutation, re-render from the server's fresh state on success. */
async function mutate(fn, okText) {
  els.msgs.innerHTML = "";
  try {
    apply(await fn());
    if (okText) pushMsg(okText);
  } catch (e) {
    pushMsg(e.message, true);
  }
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

// ---------- effect summary — a tiny pure formatter over the skill grammar
// documented in src/data/expertises.js (the engine's closed op set) ----------

const STAT_LABEL = { atk: "ATK", matk: "MATK", maxHp: "HP", spd: "SPD", crit: "CRIT", evade: "EVADE", acc: "ACC" };
const TRIGGER_LABEL = { battle_start: "battle start", after_ally_turns: "after all allies act" };
const TARGET_LABEL = { front: "front ally", lowest_hp_pct: "lowest HP" };

function describeTarget(t) {
  if (!t) return "";
  if (t.count === "all") return "all allies";
  const rule = TARGET_LABEL[t.rule] ?? t.rule;
  return t.count === 1 ? rule : `${t.count} ${rule}`;
}

function describeOp(fx) {
  if (fx.op === "perm_stat") {
    const label = STAT_LABEL[fx.stat] ?? fx.stat;
    const amt = fx.pct != null ? `${fx.pct}%` : `${fx.flat}`;
    const perLevel = fx.perLevel ? ` (+${fx.perLevel}${fx.pct != null ? "%" : ""}/lvl)` : "";
    return `${label} +${amt}${perLevel}`;
  }
  if (fx.op === "heal") {
    return `heal ${fx.pct}%${fx.perLevel ? ` (+${fx.perLevel}%/lvl)` : ""}`;
  }
  if (fx.op === "apply_status") {
    const chance = fx.chance != null ? `${fx.chance}% chance ` : "";
    return `${chance}${fx.status} (${fx.turns} turns)`;
  }
  return fx.op;
}

/** One skill's data -> a short human-readable summary, e.g.
 *  "battle start: ATK +10% (all allies)" or
 *  "after all allies act: heal 6% (lowest HP)". */
function skillSummary(skillData) {
  return (skillData?.effects ?? [])
    .map((fx) => {
      const trigger = TRIGGER_LABEL[fx.when] ?? fx.when;
      const target = describeTarget(fx.target);
      return `${trigger}: ${describeOp(fx)}${target ? ` (${target})` : ""}`;
    })
    .join("; ");
}

// ---------- rendering ----------

function render() {
  els.body.innerHTML = "";
  if (!data) return;

  const exp = el("p", "tr-exp");
  exp.innerHTML = `Trainer EXP: <b>${data.exp.toLocaleString()}</b>`;
  els.body.appendChild(exp);

  if (data.exp < data.unlockExp) {
    els.body.appendChild(el(
      "p", "tr-note",
      `Expertise unlocks at ${data.unlockExp} exp (${data.exp}/${data.unlockExp}).`
    ));
  } else if (!data.expertise) {
    els.body.appendChild(el("p", "tr-note", "Expertise unlocked — choose one below."));
  }

  els.body.appendChild(expertiseCards());
  if (data.expertise) els.body.appendChild(skillSlots());
}

function expertiseCards() {
  const grid = el("div", "tr-cards");
  const locked = data.exp < data.unlockExp;

  for (const ex of data.expertises) {
    const card = el("div", "tr-card" + (ex.id === data.expertise ? " active" : ""));
    card.append(el("h4", null, ex.name));

    const list = el("ul");
    for (const def of data.skillDefs.filter((d) => d.expertiseId === ex.id)) {
      list.append(el("li", null, `${def.name} — ${skillSummary(def.data)}`));
    }
    card.append(list);

    const actions = el("div", "tr-card-actions");
    if (ex.id === data.expertise) {
      actions.append(el("span", "tr-badge", "Active"));
    } else if (pendingSwitch === ex.id) {
      card.append(el("p", "tr-warn", "Switching wipes both learned skills. Continue?"));
      actions.append(
        button("Confirm switch", "btn primary tr-small",
          () => mutate(() => chooseExpertise(ex.id), `Expertise set to ${ex.name}.`)),
        button("Cancel", "btn ghost tr-small", () => { pendingSwitch = null; render(); }),
      );
    } else {
      const chooseBtn = button(data.expertise ? "Switch" : "Choose", "btn ghost tr-small", () => {
        if (data.expertise) {
          pendingSwitch = ex.id;
          render();
        } else {
          mutate(() => chooseExpertise(ex.id), `Expertise set to ${ex.name}.`);
        }
      });
      chooseBtn.disabled = locked;
      actions.append(chooseBtn);
    }
    card.append(actions);
    grid.appendChild(card);
  }
  return grid;
}

function skillSlots() {
  const wrap = el("div", "tr-slots");
  const learnable = data.skillDefs.filter((d) => d.expertiseId === data.expertise);

  for (let slot = 0; slot < TRAINER_SKILL_SLOTS; slot++) {
    const current = data.skills.find((s) => s.slot === slot);
    const row = el("div", "tr-slot");
    row.append(el("span", "tr-slot-label", `Skill slot ${slot + 1}`));

    const select = el("select");
    const noneOpt = el("option", null, "— empty —");
    noneOpt.value = "";
    select.appendChild(noneOpt);
    for (const def of learnable) {
      // A skill already learned in the OTHER slot can't also go here (the
      // server rejects the duplicate) — filtered out so the choice can't
      // even be attempted.
      if (data.skills.some((s) => s.slot !== slot && s.skillId === def.id)) continue;
      const opt = el("option", null, def.name);
      opt.value = def.id;
      if (current?.skillId === def.id) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => mutate(() => learnTrainerSkill(slot, select.value || null)));
    row.append(select);

    const activeDef = learnable.find((d) => d.id === current?.skillId);
    if (activeDef) row.append(el("p", "tr-slot-summary", skillSummary(activeDef.data)));
    wrap.appendChild(row);
  }
  return wrap;
}
