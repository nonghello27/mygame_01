// Admin console (Phase 5): sub-menu tabs over the master tables — Species,
// Skills, Classes (whose `icon` field, Phase 10.12 follow-up, is a live
// admin-editable pointer into public/icons/classes/ with a preview), Jobs,
// Items, Equipment, Runes, Summons, Adventures — plus a Trainers roster
// browser (browse accounts, view/mint into any trainer's monster roster), a
// read-only Sprites gallery, and a read-only Statuses reference tab (the
// engine's closed status registry, shared/rules/statuses.js, is never DB
// rows — this tab just surfaces the id/label/icon-file mapping). Pure
// presentation over /api/admin/*: every dropdown is built from the enums
// the SERVER sent (so options can't drift from the engine), every save
// posts a proposed row and re-renders the fresh masterState the server
// responds with, and every image (sprite portrait, sheet frame, emoji
// fallback, class/status icon) is shown as an image.
//
// The ⚙ button only appears for admins (ui/auth.js toggles it from the
// trainer's isAdmin flag) — but visibility is cosmetic; the API re-checks
// is_admin on every request.

import {
  loadMaster, saveClass, deleteClass, saveSkill, deleteSkill,
  saveSpecies, deleteSpecies, saveJob, deleteJob,
  saveItem, deleteItem, saveEquipment, deleteEquipment, saveRune, deleteRune,
  saveSummon, deleteSummon,
  saveAdventure, deleteAdventure,
  grant,
  loadTrainers, loadTrainerMonsters, mintMonsterFor, attachMonsterTo, detachMonsterFrom, updateTrainer,
  updateMonster,
  loadTournaments, createTournament, cancelTournament,
  loadGvgEvents, createGvgEvent, cancelGvgEvent,
} from "../services/admin.js";
import { fetchMe } from "../services/auth.js";
import { showProfile } from "./auth.js";
import { SPRITES } from "../data/sprites.js";
import { STATUS_ICONS } from "../data/statusIcons.js";
import { STATUSES } from "../../shared/rules/statuses.js";
import { chromaKeyed } from "./chroma.js";
import { registerView } from "./views.js";
import { skillAnimationEl } from "./skillMedia.js";

const TABS = [
  ["species", "🐲 Species"],
  ["skills", "✨ Skills"],
  ["classes", "🎭 Classes"],
  ["jobs", "🧰 Jobs"],
  ["items", "🎒 Items"],
  ["equipment", "⚔ Equipment"],
  ["runes", "🔮 Runes"],
  ["summons", "✨ Summons"],
  ["adventures", "🗺 Adventures"],
  ["tournaments", "🏆 Tournaments"],
  ["gvg", "⚔ GVG"],
  ["trainers", "👥 Trainers"],
  ["sprites", "🖼 Sprites"],
  ["statuses", "💫 Statuses"],
];

const ATTR_LABEL = { str: "STR", agi: "AGI", vit: "VIT", int: "INT", dex: "DEX" };

let els = null;
let data = null;    // last masterState from the server
let tab = "species";
let editing = null;  // row being edited in the current tab (null = list view)
let trainers = null; // cached trainers list (👥 tab), null = not loaded yet
let managing = null; // { trainer, monsters, unassigned } of the trainer being managed, or null
let pendingRemove = null; // monsterId awaiting a second "Remove" confirm click, or null
let tournamentsData = null; // cached admin tournaments list (🏆 tab), null = not loaded yet
let creatingTournament = false; // true while the 🏆 tab's create form is shown
let gvgData = null; // cached admin GVG events list (⚔ tab), null = not loaded yet
let creatingGvg = false; // true while the ⚔ tab's create form is shown

export function initAdmin() {
  els = {
    btn: document.getElementById("adminBtn"),
    panel: document.getElementById("adminPanel"),
    tabs: document.getElementById("adminTabs"),
    msgs: document.getElementById("adminMsgs"),
    body: document.getElementById("adminBody"),
  };
  registerView("admin", { button: els.btn, el: els.panel, onShow: refresh });
}

/** Called by ui/auth.js whenever the trainer profile is (re)shown. */
export function setAdminVisible(isAdmin) {
  if (els) els.btn.hidden = !isAdmin;
}

async function refresh() {
  els.msgs.innerHTML = "";
  try {
    apply(await loadMaster());
  } catch (e) {
    pushMsg(`Could not load master data: ${e.message}`, true);
  }
}

function apply(next) {
  data = next;
  editing = null;
  renderTabs();
  renderBody();
}

/** Run a mutation, re-render from the server's fresh state on success. */
async function mutate(fn, okText) {
  els.msgs.innerHTML = "";
  try {
    apply(await fn());
    pushMsg(okText);
  } catch (e) {
    pushMsg(e.message, true);
  }
}

/** After an admin action that can change the CALLER's own gold (e.g. "Set
 *  gold" on their own trainer row), refresh the header's gold chip the same
 *  way inventory.js's enhance/repair/sell do — best-effort, never blocks. */
async function refreshProfile() {
  const trainer = await fetchMe();
  if (trainer) showProfile(trainer);
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

function field(labelText, control) {
  const wrap = el("label", "adm-field");
  wrap.append(el("span", "adm-label", labelText), control);
  return wrap;
}

function textInput(value = "", placeholder = "") {
  const i = el("input");
  i.type = "text";
  i.value = value ?? "";
  i.placeholder = placeholder;
  return i;
}

function numInput(value, min, max) {
  const i = el("input");
  i.type = "number";
  i.value = value ?? "";
  if (min !== undefined) i.min = min;
  if (max !== undefined) i.max = max;
  return i;
}

/** @param options array of values or [value, label] pairs */
function selectInput(options, value) {
  const s = el("select");
  for (const o of options) {
    const [v, label] = Array.isArray(o) ? o : [o, o];
    const opt = el("option", null, label);
    opt.value = v;
    if (v === value) opt.selected = true;
    s.appendChild(opt);
  }
  return s;
}

function button(text, cls, onClick) {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function badge(text) {
  return el("span", "adm-badge", text);
}

/** The image for anything that has one: portrait (chroma-keyed), first sheet
 *  frame, or the emoji fallback — the same precedence the game itself uses. */
function spritePreview(spriteId, emoji, size = 44) {
  const def = spriteId ? SPRITES[spriteId] : null;
  if (def?.img) {
    const img = el("img", "adm-thumb");
    img.width = size;
    img.height = size;
    img.alt = spriteId;
    chromaKeyed(def.img)
      .then((url) => { img.src = url; })
      .catch(() => { img.src = def.img; });
    return img;
  }
  if (def?.sheet) {
    const d = el("div", "adm-thumb adm-sheet");
    const scale = size / def.cell;
    d.style.width = `${size}px`;
    d.style.height = `${size}px`;
    d.style.backgroundImage = `url("${def.sheet}")`;
    d.style.backgroundSize = `${def.cols * def.cell * scale}px auto`;
    return d;
  }
  const e = el("div", "adm-thumb adm-emoji", emoji || "❔");
  e.style.fontSize = `${Math.round(size * 0.66)}px`;
  return e;
}

// ---------- shell ----------

function renderTabs() {
  els.tabs.innerHTML = "";
  for (const [id, label] of TABS) {
    const b = button(label, "adm-tab" + (id === tab ? " active" : ""), () => {
      tab = id;
      editing = null;
      managing = null;
      pendingRemove = null;
      creatingTournament = false;
      creatingGvg = false;
      els.msgs.innerHTML = "";
      renderTabs();
      renderBody();
    });
    els.tabs.appendChild(b);
  }
}

function renderBody() {
  els.body.innerHTML = "";
  if (!data) return;
  ({
    species: speciesTab, skills: skillsTab, classes: classesTab, jobs: jobsTab,
    items: itemsTab, equipment: equipmentTab, runes: runesTab,
    summons: summonsTab, adventures: adventuresTab, tournaments: tournamentsTab,
    gvg: gvgTab, trainers: trainersTab, sprites: spritesTab, statuses: statusesTab,
  })[tab]();
}

function toolbar(newLabel, makeBlank) {
  const bar = el("div", "adm-toolbar");
  bar.appendChild(button(newLabel, "btn ghost adm-small", () => {
    editing = makeBlank();
    renderBody();
  }));
  return bar;
}

// ---------- species ----------

function speciesTab() {
  if (editing) return speciesForm(editing);
  els.body.appendChild(toolbar("＋ New species", () => ({
    id: "", name: "", cls: data.classes[0]?.cls ?? "", emoji: "❔", sprite: null,
    starter: false, element: "neutral", rank: "D", attackKind: "melee", attackStyle: "phys",
    targeting: "front", base: { hp: 100, atk: 20, spd: 6 },
    attrs: { str: 5, agi: 5, vit: 5, int: 5, dex: 5 }, skills: [null, null, null, null],
    runeSlots: 1, monsterCount: 0, isNew: true,
  })));

  for (const s of data.species) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    id.append(spritePreview(s.sprite, s.emoji));
    const txt = el("span");
    txt.append(el("b", null, s.name), el("small", null,
      `${s.id} · ${s.cls} · ${s.element} · ${s.attackKind}/${s.attackStyle} · ` +
      `HP ${s.base.hp} ATK ${s.base.atk} SPD ${s.base.spd} · rune slots ${s.runeSlots ?? 1}`));
    id.append(txt);

    const side = el("div", "adm-actions");
    side.append(badge(s.rank ?? "D"));
    if (s.starter) side.append(badge("starter"));
    if (s.monsterCount > 0) side.append(badge(`${s.monsterCount} owned`));
    side.append(
      button("Edit", "btn ghost adm-small", () => { editing = structuredClone(s); renderBody(); }),
      button("Delete", "btn ghost adm-small adm-danger", () => confirmDelete(
        `Delete species "${s.name}" (${s.id})?`, () => deleteSpecies(s.id), "Species deleted")),
    );
    row.append(id, side);
    els.body.appendChild(row);
  }
}

function speciesForm(s) {
  const E = data.enums;
  const form = el("div", "adm-form");
  form.appendChild(el("h4", null, s.isNew ? "New species" : `Edit species — ${s.name}`));

  const f = {
    id: textInput(s.id, "sp_myspecies"),
    name: textInput(s.name),
    cls: selectInput(data.classes.map((c) => c.cls), s.cls),
    emoji: textInput(s.emoji, "🐲"),
    sprite: selectInput([["", "— emoji only —"], ...Object.keys(SPRITES)], s.sprite ?? ""),
    starter: el("input"),
    element: selectInput(E.elements, s.element),
    rank: selectInput(E.ranks, s.rank ?? "D"),
    attackKind: selectInput(E.attackKinds, s.attackKind),
    attackStyle: selectInput(E.attackStyles, s.attackStyle),
    targeting: selectInput(E.targeting, s.targeting),
    hp: numInput(s.base.hp, 1, 9999),
    atk: numInput(s.base.atk, 1, 999),
    spd: numInput(s.base.spd, 1, 99),
    attrs: Object.fromEntries(E.attrs.map((a) => [a, numInput(s.attrs[a], 0, 99)])),
    runeSlots: numInput(s.runeSlots ?? 1, 0, 5),
    skills: E.loadoutSlotTypes.map((want, slot) => selectInput(
      [["", "— empty —"], ...data.skills.filter((k) => k.slot === want).map((k) => [k.id, `${k.name} (${k.id})`])],
      s.skills[slot] ?? "",
    )),
  };
  f.starter.type = "checkbox";
  f.starter.checked = s.starter;
  f.id.disabled = !s.isNew; // stable DB key — never renumber

  // Live visual preview: what this species will look like on the board.
  const preview = el("div", "adm-preview");
  const paintPreview = () => {
    preview.innerHTML = "";
    preview.append(spritePreview(f.sprite.value || null, f.emoji.value, 96));
    const def = f.sprite.value ? SPRITES[f.sprite.value] : null;
    preview.append(el("small", null,
      def ? (def.img ? `portrait ${def.img}` : `sheet ${def.sheet}`) : "emoji fallback"));
  };
  f.sprite.addEventListener("change", paintPreview);
  f.emoji.addEventListener("input", paintPreview);
  paintPreview();

  const grid = el("div", "adm-grid");
  grid.append(
    field("Id (permanent)", f.id), field("Name", f.name), field("Class", f.cls),
    field("Emoji", f.emoji), field("Sprite", f.sprite), field("Starter", f.starter),
    field("Element", f.element), field("Rank", f.rank), field("Attack kind", f.attackKind),
    field("Attack style", f.attackStyle), field("Targeting", f.targeting),
    field("Base HP", f.hp), field("Base ATK", f.atk), field("Base SPD", f.spd),
    ...E.attrs.map((a) => field(ATTR_LABEL[a] ?? a, f.attrs[a])),
    field("Rune slots", f.runeSlots),
    ...f.skills.map((sel, slot) => field(`Skill slot ${slot} (${E.loadoutSlotTypes[slot]})`, sel)),
  );

  form.append(preview, grid, formButtons(() => saveSpecies({
    id: f.id.value.trim(),
    name: f.name.value.trim(),
    cls: f.cls.value,
    emoji: f.emoji.value.trim(),
    sprite: f.sprite.value || null,
    starter: f.starter.checked,
    element: f.element.value,
    rank: f.rank.value,
    attackKind: f.attackKind.value,
    attackStyle: f.attackStyle.value,
    targeting: f.targeting.value,
    base: { hp: +f.hp.value, atk: +f.atk.value, spd: +f.spd.value },
    attrs: Object.fromEntries(E.attrs.map((a) => [a, +f.attrs[a].value])),
    runeSlots: +f.runeSlots.value,
    skills: f.skills.map((sel) => sel.value || null),
  }), "Species saved"));
  els.body.appendChild(form);
}

// ---------- skills ----------

const SKILL_DATA_HINT =
  'power {scale:"phys|mag", pct, perLevel?} · target {rule?, count?|"all"} · ' +
  'onHit [{op:"apply_status", status, chance, turns, pct?}] · ' +
  'support [{op:"heal", pct} | {op:"apply_status", …, target?}] · ' +
  'passive [{when:"battle_start", op:"perm_stat", stat, pct?|flat?}]';

function skillsTab() {
  if (editing) return skillForm(editing);
  els.body.appendChild(toolbar("＋ New skill", () => ({
    id: "", name: "", slot: "normal", cooldown: 0,
    data: { power: { scale: "phys", pct: 120, perLevel: 5 } },
    icon: null, animation: null,
    speciesUses: 0, monsterUses: 0, isNew: true,
  })));

  for (const k of data.skills) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    id.append(iconImg("skills", k.icon || k.slot || "default", k.name, 26));
    const txt = el("span");
    txt.append(el("b", null, k.name), el("small", null, `${k.id} · cooldown ${k.cooldown} · ${summarizeSkill(k.data)}`));
    id.append(txt);
    const side = el("div", "adm-actions");
    side.append(badge(k.slot));
    if (k.speciesUses > 0) side.append(badge(`${k.speciesUses} species`));
    if (k.monsterUses > 0) side.append(badge(`${k.monsterUses} monsters`));
    side.append(
      button("Edit", "btn ghost adm-small", () => { editing = structuredClone(k); renderBody(); }),
      button("Delete", "btn ghost adm-small adm-danger", () => confirmDelete(
        `Delete skill "${k.name}" (${k.id})?`, () => deleteSkill(k.id), "Skill deleted")),
    );
    row.append(id, side);
    els.body.appendChild(row);
  }
}

function summarizeSkill(d) {
  const bits = [];
  if (d.power) bits.push(`${d.power.pct}% ${d.power.scale}`);
  if (d.target?.count === "all") bits.push("hits all");
  if (d.onHit) bits.push(d.onHit.map((o) => `${o.chance ?? 100}% ${o.status}`).join(", "));
  if (d.support) bits.push("support: " + d.support.map((o) => o.op === "heal" ? `heal ${o.pct}%` : o.status).join(", "));
  if (d.passive) bits.push("passive: " + d.passive.map((o) => `${o.stat} ${o.pct != null ? o.pct + "%" : "+" + o.flat}`).join(", "));
  return bits.join(" · ") || "—";
}

function skillForm(k) {
  const form = el("div", "adm-form");
  form.appendChild(el("h4", null, k.isNew ? "New skill" : `Edit skill — ${k.name}`));

  const f = {
    id: textInput(k.id, "sk_my_skill"),
    name: textInput(k.name),
    slot: selectInput(data.enums.skillSlots, k.slot),
    cooldown: numInput(k.cooldown, 0, 20),
    icon: textInput(k.icon ?? "", "normal"),
    animation: textInput(k.animation ?? "", "sample_slash.svg"),
    data: el("textarea"),
  };
  f.id.disabled = !k.isNew;
  f.data.rows = 8;
  f.data.spellcheck = false;
  f.data.value = JSON.stringify(k.data, null, 2);

  // Live icon preview — the classForm paintPreview pattern, repaints on
  // icon/slot input (empty icon falls back to the slot placeholder).
  const iconPreview = el("div", "adm-preview");
  const paintIconPreview = () => {
    iconPreview.innerHTML = "";
    const base = f.icon.value.trim() || f.slot.value || "default";
    iconPreview.append(iconImg("skills", base, f.name.value, 64), el("small", null, `/icons/skills/${base}.png`));
  };
  f.icon.addEventListener("input", paintIconPreview);
  f.slot.addEventListener("change", paintIconPreview);
  paintIconPreview();

  // Live animation preview — extension picks the renderer (ui/skillMedia.js).
  const animPreview = el("div", "adm-preview");
  const paintAnimPreview = () => {
    animPreview.innerHTML = "";
    const file = f.animation.value.trim();
    if (!file) {
      animPreview.append(el("small", null, "no animation"));
      return;
    }
    const media = skillAnimationEl(file);
    if (media) animPreview.append(media);
    animPreview.append(el("small", null, `/anim/skills/${file}`));
  };
  f.animation.addEventListener("input", paintAnimPreview);
  paintAnimPreview();

  const grid = el("div", "adm-grid");
  grid.append(field("Id (permanent)", f.id), field("Name", f.name),
    field("Slot", f.slot), field("Cooldown (turns)", f.cooldown),
    field("Icon id", f.icon), field("Animation file", f.animation));

  const dataField = field("Data (JSON — the engine's closed grammar)", f.data);
  dataField.classList.add("adm-wide");

  form.append(iconPreview, animPreview, grid, dataField, el("p", "adm-hint", SKILL_DATA_HINT),
    el("p", "adm-hint",
      "Icon art lives in public/icons/skills/ (see that folder's README) — leave " +
      "blank to fall back to the skill's slot placeholder, then default.png."),
    el("p", "adm-hint",
      "Animation is a filename in public/anim/skills/ (see that folder's README) — " +
      ".svg renders as a self-animating SVG, .png as a CSS sprite strip of square " +
      "frames; leave blank for none."),
    formButtons(() => {
      let parsed;
      try {
        parsed = JSON.parse(f.data.value);
      } catch {
        throw new Error("Data is not valid JSON — fix the syntax and save again");
      }
      return saveSkill({
        id: f.id.value.trim(), name: f.name.value.trim(),
        slot: f.slot.value, cooldown: +f.cooldown.value, data: parsed,
        icon: f.icon.value.trim() || null, animation: f.animation.value.trim() || null,
      });
    }, "Skill saved"));
  els.body.appendChild(form);
}

// ---------- classes ----------

function classesTab() {
  if (editing) return classForm(editing);
  els.body.appendChild(toolbar("＋ New class", () => ({ cls: "", attackName: "", fx: "", icon: null, speciesCount: 0, isNew: true })));

  for (const c of data.classes) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    id.append(iconImg("classes", c.icon || c.cls.toLowerCase(), c.cls, 26));
    const txt = el("span");
    txt.append(el("b", null, c.cls), el("small", null, `attack “${c.attackName}” · fx ${c.fx}`));
    id.append(txt);
    const side = el("div", "adm-actions");
    if (c.speciesCount > 0) side.append(badge(`${c.speciesCount} species`));
    side.append(
      button("Edit", "btn ghost adm-small", () => { editing = { ...c }; renderBody(); }),
      button("Delete", "btn ghost adm-small adm-danger", () => confirmDelete(
        `Delete class "${c.cls}"?`, () => deleteClass(c.cls), "Class deleted")),
    );
    row.append(id, side);
    els.body.appendChild(row);
  }
}

/** A `/icons/<dir>/<base>.png` image with the standard default.png fallback
 *  (the onerror is re-armed each time src changes so a repeated bad value
 *  still falls back cleanly — used by both list rows and live form previews).
 *  Shared by the Classes tab (`dir:"classes"`), Skills tab (`dir:"skills"`,
 *  Phase 10.13), and the Items/Equipment/Runes tabs (`dir:"items"` /
 *  `"equipment"` / `"runes"`, Phase 10.17). */
function iconImg(dir, base, title, size = 44) {
  const img = el("img", "adm-thumb");
  img.width = size;
  img.height = size;
  img.alt = title || "";
  img.title = title || "";
  img.src = `/icons/${dir}/${base}.png`;
  img.onerror = () => {
    img.onerror = null; // guard: a missing default.png must not loop
    img.src = `/icons/${dir}/default.png`;
  };
  return img;
}

function classForm(c) {
  const form = el("div", "adm-form");
  form.appendChild(el("h4", null, c.isNew ? "New class" : `Edit class — ${c.cls}`));
  const f = {
    cls: textInput(c.cls, "Knight"),
    attackName: textInput(c.attackName, "Blade Arc"),
    fx: textInput(c.fx, "slash"),
    icon: textInput(c.icon ?? "", "knight"),
  };
  f.cls.disabled = !c.isNew;

  // Live visual preview: the icon this class will render with on the board.
  const preview = el("div", "adm-preview");
  const paintPreview = () => {
    preview.innerHTML = "";
    const base = f.icon.value.trim() || f.cls.value.trim().toLowerCase() || "default";
    preview.append(iconImg("classes", base, f.cls.value, 64), el("small", null, `/icons/classes/${base}.png`));
  };
  f.icon.addEventListener("input", paintPreview);
  f.cls.addEventListener("input", paintPreview);
  paintPreview();

  const grid = el("div", "adm-grid");
  grid.append(
    field("Class (permanent)", f.cls), field("Attack name", f.attackName),
    field("Fx id", f.fx), field("Icon id", f.icon),
  );
  form.append(preview, grid,
    el("p", "adm-hint",
      "A brand-new fx id also needs a portrait case in cutscene/portraits.js and " +
      "keyframes in styles/cutscene.css — until then the cutscene falls back to a plain hit."),
    el("p", "adm-hint",
      "Icon art lives in public/icons/classes/ (see that folder's README) — leave " +
      "blank to fall back to the class name lowercased."),
    formButtons(() => saveClass({
      cls: f.cls.value.trim(), attackName: f.attackName.value.trim(), fx: f.fx.value.trim(),
      icon: f.icon.value.trim() || null,
    }), "Class saved"));
  els.body.appendChild(form);
}

// ---------- jobs ----------

function jobsTab() {
  if (editing) return jobForm(editing);
  els.body.appendChild(toolbar("＋ New job", () => ({
    id: "", kind: "work", name: "", durationS: 300,
    rewards: { gold: 10, trainerExp: 5 }, activityCount: 0, isNew: true,
  })));

  for (const j of data.jobs) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    const txt = el("span");
    const reward = j.kind === "work"
      ? `+${j.rewards.gold} 🪙 +${j.rewards.trainerExp} ⭐`
      : `+${j.rewards.gain} ${ATTR_LABEL[j.rewards.attr] ?? j.rewards.attr}`;
    txt.append(el("b", null, j.name), el("small", null, `${j.id} · ${fmtDur(j.durationS)} · ${reward}`));
    id.append(txt);
    const side = el("div", "adm-actions");
    side.append(badge(j.kind));
    if (j.activityCount > 0) side.append(badge(`${j.activityCount} runs`));
    side.append(
      button("Edit", "btn ghost adm-small", () => { editing = structuredClone(j); renderBody(); }),
      button("Delete", "btn ghost adm-small adm-danger", () => confirmDelete(
        `Delete job "${j.name}" (${j.id})?`, () => deleteJob(j.id), "Job deleted")),
    );
    row.append(id, side);
    els.body.appendChild(row);
  }
}

function jobForm(j) {
  const E = data.enums;
  const form = el("div", "adm-form");
  form.appendChild(el("h4", null, j.isNew ? "New job" : `Edit job — ${j.name}`));

  const f = {
    id: textInput(j.id, "job_delivery / train_str"),
    kind: selectInput(E.jobKinds, j.kind),
    name: textInput(j.name),
    durationS: numInput(j.durationS, 10),
    gold: numInput(j.rewards.gold ?? 10, 0),
    trainerExp: numInput(j.rewards.trainerExp ?? 5, 0),
    attr: selectInput(E.attrs.map((a) => [a, ATTR_LABEL[a] ?? a]), j.rewards.attr ?? "str"),
    gain: numInput(j.rewards.gain ?? 1, 1, 10),
  };
  f.id.disabled = !j.isNew;

  const grid = el("div", "adm-grid");
  grid.append(field("Id (permanent)", f.id), field("Kind", f.kind),
    field("Name", f.name), field("Duration (seconds)", f.durationS));

  // Reward fields depend on the kind — swap them when it changes.
  const rewardsGrid = el("div", "adm-grid");
  const paintRewards = () => {
    rewardsGrid.innerHTML = "";
    if (f.kind.value === "work") {
      rewardsGrid.append(field("Gold", f.gold), field("Trainer EXP", f.trainerExp));
    } else {
      rewardsGrid.append(field("Attribute", f.attr), field("Gain", f.gain));
    }
  };
  f.kind.addEventListener("change", paintRewards);
  paintRewards();

  form.append(grid, el("p", "adm-hint", "Rewards"), rewardsGrid,
    formButtons(() => saveJob({
      id: f.id.value.trim(), kind: f.kind.value, name: f.name.value.trim(),
      durationS: +f.durationS.value,
      rewards: f.kind.value === "work"
        ? { gold: +f.gold.value, trainerExp: +f.trainerExp.value }
        : { attr: f.attr.value, gain: +f.gain.value },
    }), "Job saved"));
  els.body.appendChild(form);
}

// ---------- items / equipment / runes (Phase 7.1) -------------------------------

const EFFECTS_HINT =
  'effects [{when:"battle_start", op:"perm_stat", stat, pct?|flat?, perLevel?}] — ' +
  "same grammar as a skill passive, but perLevel is allowed here.";

/** Run a grant against the calling admin's own account, then reload the
 *  master list (so ownedCount badges reflect it) and confirm. */
async function grantRow(kind, defId, label, qty) {
  els.msgs.innerHTML = "";
  try {
    await grant(qty === undefined ? { kind, defId } : { kind, defId, qty });
    await refresh();
    pushMsg(`Granted "${label}" to your own account.`);
  } catch (e) {
    pushMsg(e.message, true);
  }
}

/** The little "Grant to me" control shown on each def row. Items carry a qty
 *  input (default 1); equipment/runes grant one instance per click. */
function grantControl(kind, defId, label, withQty) {
  const wrap = el("span", "adm-grant");
  let qtyInput = null;
  if (withQty) {
    qtyInput = numInput(1, 1, 1000);
    qtyInput.className = "adm-grant-qty";
    wrap.appendChild(qtyInput);
  }
  wrap.appendChild(button("Grant to me", "btn ghost adm-small", () =>
    grantRow(kind, defId, label, withQty ? +qtyInput.value : undefined)));
  return wrap;
}

function itemsTab() {
  if (editing) return itemForm(editing);
  els.body.appendChild(toolbar("＋ New item", () => ({
    id: "", kind: data.enums.itemKinds[0] ?? "material", name: "", description: "",
    icon: null, sellGold: 0, ownedCount: 0, isNew: true,
  })));

  for (const it of data.itemDefs) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    id.append(iconImg("items", it.icon || it.id, it.name, 26));
    const txt = el("span");
    txt.append(el("b", null, it.name), el("small", null, `${it.id} · ${it.description || "—"}`));
    id.append(txt);
    const side = el("div", "adm-actions");
    side.append(badge(it.kind));
    side.append(badge(it.sellGold > 0 ? `sells for ${it.sellGold} 🪙` : "not sellable"));
    if (it.ownedCount > 0) side.append(badge(`${it.ownedCount} owned`));
    side.append(
      grantControl("item", it.id, it.name, true),
      button("Edit", "btn ghost adm-small", () => { editing = structuredClone(it); renderBody(); }),
      button("Delete", "btn ghost adm-small adm-danger", () => confirmDelete(
        `Delete item "${it.name}" (${it.id})?`, () => deleteItem(it.id), "Item deleted")),
    );
    row.append(id, side);
    els.body.appendChild(row);
  }
}

function itemForm(it) {
  const form = el("div", "adm-form");
  form.appendChild(el("h4", null, it.isNew ? "New item" : `Edit item — ${it.name}`));

  const f = {
    id: textInput(it.id, "it_my_item"),
    kind: selectInput(data.enums.itemKinds, it.kind),
    name: textInput(it.name),
    description: textInput(it.description ?? "", "optional"),
    icon: textInput(it.icon ?? "", "potion"),
    sellGold: numInput(it.sellGold ?? 0, 0, 1_000_000),
  };
  f.id.disabled = !it.isNew;

  // Live icon preview — the classForm/skillForm paintPreview pattern,
  // repaints on BOTH icon and id input (id matters while creating a new
  // item, since an empty icon falls back to it).
  const iconPreview = el("div", "adm-preview");
  const paintIconPreview = () => {
    iconPreview.innerHTML = "";
    const base = f.icon.value.trim() || f.id.value.trim() || "default";
    iconPreview.append(iconImg("items", base, f.name.value, 64), el("small", null, `/icons/items/${base}.png`));
  };
  f.icon.addEventListener("input", paintIconPreview);
  f.id.addEventListener("input", paintIconPreview);
  paintIconPreview();

  const grid = el("div", "adm-grid");
  grid.append(field("Id (permanent)", f.id), field("Kind", f.kind),
    field("Name", f.name), field("Description", f.description),
    field("Icon id", f.icon), field("Sell gold (0 = not sellable)", f.sellGold));

  form.append(iconPreview, grid,
    el("p", "adm-hint",
      "Icon art lives in public/icons/items/ (see that folder's README) — leave " +
      "blank to fall back to the def id, then default.png."),
    formButtons(() => saveItem({
      id: f.id.value.trim(), kind: f.kind.value,
      name: f.name.value.trim(), description: f.description.value.trim() || null,
      icon: f.icon.value.trim() || null, sellGold: +f.sellGold.value,
    }), "Item saved"));
  els.body.appendChild(form);
}

function equipmentTab() {
  if (editing) return equipmentForm(editing);
  els.body.appendChild(toolbar("＋ New equipment", () => {
    const domain = data.enums.equipDomains[0] ?? "monster";
    return {
      id: "", domain, slot: data.enums.equipSlots[domain]?.[0] ?? "",
      name: "", description: "", icon: null,
      effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 10, perLevel: 2 }],
      enhance: { maxLevel: 5, goldPerLevel: 50 },
      sellGold: 0, trainerOwned: 0, monsterOwned: 0, isNew: true,
    };
  }));

  for (const eq of data.equipmentDefs) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    id.append(iconImg("equipment", eq.icon || eq.id, eq.name, 26));
    const txt = el("span");
    txt.append(el("b", null, eq.name), el("small", null, `${eq.id} · ${eq.description || "—"}`));
    id.append(txt);
    const side = el("div", "adm-actions");
    side.append(badge(`${eq.domain} · ${eq.slot}`));
    if (eq.enhance) side.append(badge(`up to +${eq.enhance.maxLevel}`));
    side.append(badge(eq.sellGold > 0 ? `sells for ${eq.sellGold} 🪙` : "not sellable"));
    if (eq.trainerOwned > 0) side.append(badge(`${eq.trainerOwned} trainer-owned`));
    if (eq.monsterOwned > 0) side.append(badge(`${eq.monsterOwned} monster-owned`));
    side.append(
      grantControl("equipment", eq.id, eq.name, false),
      button("Edit", "btn ghost adm-small", () => { editing = structuredClone(eq); renderBody(); }),
      button("Delete", "btn ghost adm-small adm-danger", () => confirmDelete(
        `Delete equipment "${eq.name}" (${eq.id})?`, () => deleteEquipment(eq.id), "Equipment deleted")),
    );
    row.append(id, side);
    els.body.appendChild(row);
  }
}

function equipmentForm(eq) {
  const E = data.enums;
  const form = el("div", "adm-form");
  form.appendChild(el("h4", null, eq.isNew ? "New equipment" : `Edit equipment — ${eq.name}`));

  const f = {
    id: textInput(eq.id, "eq_my_gear"),
    domain: selectInput(E.equipDomains, eq.domain),
    slot: selectInput(E.equipSlots[eq.domain] ?? [], eq.slot),
    name: textInput(eq.name),
    description: textInput(eq.description ?? "", "optional"),
    icon: textInput(eq.icon ?? "", "sword"),
    effects: el("textarea"),
    enhanced: el("input"),
    maxLevel: numInput(eq.enhance?.maxLevel ?? 5, 1, 20),
    goldPerLevel: numInput(eq.enhance?.goldPerLevel ?? 50, 1, 1_000_000),
    sellGold: numInput(eq.sellGold ?? 0, 0, 1_000_000),
  };
  f.id.disabled = !eq.isNew;
  f.effects.rows = 6;
  f.effects.spellcheck = false;
  f.effects.value = JSON.stringify(eq.effects, null, 2);
  f.enhanced.type = "checkbox";
  f.enhanced.checked = !!eq.enhance;

  // Slot options depend on the chosen domain — repaint when it changes.
  f.domain.addEventListener("change", () => {
    const opts = E.equipSlots[f.domain.value] ?? [];
    const fresh = selectInput(opts, opts[0]);
    f.slot.replaceWith(fresh);
    f.slot = fresh;
  });

  // Live icon preview — the classForm/skillForm paintPreview pattern,
  // repaints on BOTH icon and id input (id matters while creating a new
  // piece, since an empty icon falls back to it).
  const iconPreview = el("div", "adm-preview");
  const paintIconPreview = () => {
    iconPreview.innerHTML = "";
    const base = f.icon.value.trim() || f.id.value.trim() || "default";
    iconPreview.append(iconImg("equipment", base, f.name.value, 64), el("small", null, `/icons/equipment/${base}.png`));
  };
  f.icon.addEventListener("input", paintIconPreview);
  f.id.addEventListener("input", paintIconPreview);
  paintIconPreview();

  const grid = el("div", "adm-grid");
  grid.append(field("Id (permanent)", f.id), field("Domain", f.domain), field("Slot", f.slot),
    field("Name", f.name), field("Description", f.description),
    field("Icon id", f.icon), field("Sell gold (0 = not sellable)", f.sellGold));

  const effectsField = field("Effects (JSON)", f.effects);
  effectsField.classList.add("adm-wide");

  const enhanceGrid = el("div", "adm-grid");
  const paintEnhance = () => {
    enhanceGrid.innerHTML = "";
    if (f.enhanced.checked) enhanceGrid.append(field("Max level", f.maxLevel), field("Gold per level", f.goldPerLevel));
  };
  f.enhanced.addEventListener("change", paintEnhance);
  paintEnhance();

  form.append(iconPreview, grid, effectsField, el("p", "adm-hint", EFFECTS_HINT),
    el("p", "adm-hint",
      "Icon art lives in public/icons/equipment/ (see that folder's README) — leave " +
      "blank to fall back to the def id, then default.png."),
    field("Enhanceable", f.enhanced), enhanceGrid,
    formButtons(() => {
      let effects;
      try {
        effects = JSON.parse(f.effects.value);
      } catch {
        throw new Error("Effects is not valid JSON — fix the syntax and save again");
      }
      return saveEquipment({
        id: f.id.value.trim(), domain: f.domain.value, slot: f.slot.value,
        name: f.name.value.trim(), description: f.description.value.trim() || null,
        icon: f.icon.value.trim() || null,
        effects,
        enhance: f.enhanced.checked
          ? { maxLevel: +f.maxLevel.value, goldPerLevel: +f.goldPerLevel.value }
          : null,
        sellGold: +f.sellGold.value,
      });
    }, "Equipment saved"));
  els.body.appendChild(form);
}

function runesTab() {
  if (editing) return runeForm(editing);
  els.body.appendChild(toolbar("＋ New rune", () => ({
    id: "", name: "", description: "", icon: null,
    effects: [{ when: "battle_start", op: "perm_stat", stat: "spd", flat: 2, perLevel: 1 }],
    maxCharges: 5, repairGold: 30, sellGold: 0, ownedCount: 0, isNew: true,
  })));

  for (const rn of data.runeDefs) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    id.append(iconImg("runes", rn.icon || rn.id, rn.name, 26));
    const txt = el("span");
    txt.append(el("b", null, rn.name), el("small", null, `${rn.id} · ${rn.description || "—"}`));
    id.append(txt);
    const side = el("div", "adm-actions");
    side.append(badge(`${rn.maxCharges} charges`), badge(`repair ${rn.repairGold} 🪙`));
    side.append(badge(rn.sellGold > 0 ? `sells for ${rn.sellGold} 🪙` : "not sellable"));
    if (rn.ownedCount > 0) side.append(badge(`${rn.ownedCount} owned`));
    side.append(
      grantControl("rune", rn.id, rn.name, false),
      button("Edit", "btn ghost adm-small", () => { editing = structuredClone(rn); renderBody(); }),
      button("Delete", "btn ghost adm-small adm-danger", () => confirmDelete(
        `Delete rune "${rn.name}" (${rn.id})?`, () => deleteRune(rn.id), "Rune deleted")),
    );
    row.append(id, side);
    els.body.appendChild(row);
  }
}

function runeForm(rn) {
  const form = el("div", "adm-form");
  form.appendChild(el("h4", null, rn.isNew ? "New rune" : `Edit rune — ${rn.name}`));

  const f = {
    id: textInput(rn.id, "rn_my_rune"),
    name: textInput(rn.name),
    description: textInput(rn.description ?? "", "optional"),
    icon: textInput(rn.icon ?? "", "gem"),
    effects: el("textarea"),
    maxCharges: numInput(rn.maxCharges, 1, 100),
    repairGold: numInput(rn.repairGold, 0, 1_000_000),
    sellGold: numInput(rn.sellGold ?? 0, 0, 1_000_000),
  };
  f.id.disabled = !rn.isNew;
  f.effects.rows = 6;
  f.effects.spellcheck = false;
  f.effects.value = JSON.stringify(rn.effects, null, 2);

  // Live icon preview — the classForm/skillForm paintPreview pattern,
  // repaints on BOTH icon and id input (id matters while creating a new
  // rune, since an empty icon falls back to it).
  const iconPreview = el("div", "adm-preview");
  const paintIconPreview = () => {
    iconPreview.innerHTML = "";
    const base = f.icon.value.trim() || f.id.value.trim() || "default";
    iconPreview.append(iconImg("runes", base, f.name.value, 64), el("small", null, `/icons/runes/${base}.png`));
  };
  f.icon.addEventListener("input", paintIconPreview);
  f.id.addEventListener("input", paintIconPreview);
  paintIconPreview();

  const grid = el("div", "adm-grid");
  grid.append(field("Id (permanent)", f.id), field("Name", f.name), field("Description", f.description),
    field("Icon id", f.icon), field("Max charges", f.maxCharges), field("Repair gold", f.repairGold),
    field("Sell gold (0 = not sellable)", f.sellGold));

  const effectsField = field("Effects (JSON)", f.effects);
  effectsField.classList.add("adm-wide");

  form.append(iconPreview, grid, effectsField, el("p", "adm-hint", EFFECTS_HINT),
    el("p", "adm-hint",
      "Icon art lives in public/icons/runes/ (see that folder's README) — leave " +
      "blank to fall back to the def id, then default.png."),
    formButtons(() => {
      let effects;
      try {
        effects = JSON.parse(f.effects.value);
      } catch {
        throw new Error("Effects is not valid JSON — fix the syntax and save again");
      }
      return saveRune({
        id: f.id.value.trim(), name: f.name.value.trim(),
        description: f.description.value.trim() || null,
        icon: f.icon.value.trim() || null,
        effects, maxCharges: +f.maxCharges.value, repairGold: +f.repairGold.value,
        sellGold: +f.sellGold.value,
      });
    }, "Rune saved"));
  els.body.appendChild(form);
}

// ---------- summons (Phase 7.4 step A) ----------

const SUMMON_COST_HINT =
  'cost [{type:"gold", amount} | {type:"item", itemId, qty}] — at most one ' +
  "gold entry, no duplicate itemIds, every itemId must name a real item.";
const SUMMON_POOL_HINT =
  'pool [{speciesId, weight}] — no duplicate speciesIds, every speciesId ' +
  "must name a real species; rollSummon() draws one, weighted, per pull.";

function summonsTab() {
  if (editing) return summonForm(editing);
  els.body.appendChild(toolbar("＋ New summon", () => ({
    id: "", name: "", description: "",
    cost: [{ type: "gold", amount: 100 }],
    pool: [{ speciesId: data.species[0]?.id ?? "", weight: 1 }],
    enabled: true, pullCount: 0, isNew: true,
  })));

  for (const sm of data.summonDefs) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    const txt = el("span");
    txt.append(el("b", null, sm.name), el("small", null, `${sm.id} · ${sm.description || "—"}`));
    id.append(txt);
    const side = el("div", "adm-actions");
    side.append(badge(sm.enabled ? "enabled" : "disabled"));
    if (sm.pullCount > 0) side.append(badge(`${sm.pullCount} pulls`));
    side.append(
      button("Edit", "btn ghost adm-small", () => { editing = structuredClone(sm); renderBody(); }),
      button("Delete", "btn ghost adm-small adm-danger", () => confirmDelete(
        `Delete summon "${sm.name}" (${sm.id})?`, () => deleteSummon(sm.id), "Summon deleted")),
    );
    row.append(id, side);
    els.body.appendChild(row);
  }
}

function summonForm(sm) {
  const form = el("div", "adm-form");
  form.appendChild(el("h4", null, sm.isNew ? "New summon" : `Edit summon — ${sm.name}`));

  const f = {
    id: textInput(sm.id, "sm_my_banner"),
    name: textInput(sm.name),
    description: textInput(sm.description ?? "", "optional"),
    enabled: el("input"),
    cost: el("textarea"),
    pool: el("textarea"),
  };
  f.id.disabled = !sm.isNew;
  f.enabled.type = "checkbox";
  f.enabled.checked = sm.enabled !== false;
  f.cost.rows = 5;
  f.cost.spellcheck = false;
  f.cost.value = JSON.stringify(sm.cost, null, 2);
  f.pool.rows = 6;
  f.pool.spellcheck = false;
  f.pool.value = JSON.stringify(sm.pool, null, 2);

  const grid = el("div", "adm-grid");
  grid.append(field("Id (permanent)", f.id), field("Name", f.name),
    field("Description", f.description), field("Enabled", f.enabled));

  const costField = field("Cost (JSON)", f.cost);
  costField.classList.add("adm-wide");
  const poolField = field("Pool (JSON)", f.pool);
  poolField.classList.add("adm-wide");

  form.append(grid,
    costField, el("p", "adm-hint", SUMMON_COST_HINT),
    poolField, el("p", "adm-hint", SUMMON_POOL_HINT),
    formButtons(() => {
      let cost, pool;
      try {
        cost = JSON.parse(f.cost.value);
      } catch {
        throw new Error("Cost is not valid JSON — fix the syntax and save again");
      }
      try {
        pool = JSON.parse(f.pool.value);
      } catch {
        throw new Error("Pool is not valid JSON — fix the syntax and save again");
      }
      return saveSummon({
        id: f.id.value.trim(), name: f.name.value.trim(),
        description: f.description.value.trim() || null,
        cost, pool, enabled: f.enabled.checked,
      });
    }, "Summon saved"));
  els.body.appendChild(form);
}

// ---------- adventures (Phase 7.4 step B) ----------

const ADVENTURE_CONFIG_HINT =
  "config (JSON) — steps 3-10, choices 2-3 per step, nodes [{type: " +
  '"battle"|"chest"|"gather", weight}] (no duplicate types, the table each ' +
  "non-final step's options draw from — the final step is always all-battle), " +
  "encounters [{speciesId, weight}] (the wild pool a battle node's enemy " +
  "team draws from), loot / gather [{itemId, weight, qtyMin, qtyMax}] " +
  "(chest / gather drops), catchPct 0-100 (chance to catch one defeated " +
  "wild monster after winning a battle node). Full grammar: " +
  "src/data/adventures.js's header.";

function adventuresTab() {
  if (editing) return adventureForm(editing);
  els.body.appendChild(toolbar("＋ New adventure", () => ({
    id: "", name: "", description: "",
    config: {
      steps: 5, choices: 2,
      nodes: [
        { type: "battle", weight: 50 },
        { type: "chest", weight: 25 },
        { type: "gather", weight: 25 },
      ],
      encounters: [{ speciesId: data.species[0]?.id ?? "", weight: 1 }],
      loot: [{ itemId: data.itemDefs[0]?.id ?? "", weight: 1, qtyMin: 1, qtyMax: 1 }],
      gather: [{ itemId: data.itemDefs[0]?.id ?? "", weight: 1, qtyMin: 1, qtyMax: 1 }],
      catchPct: 25,
    },
    enabled: true, sessionCount: 0, isNew: true,
  })));

  for (const ad of data.adventureDefs) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    const txt = el("span");
    txt.append(el("b", null, ad.name), el("small", null, `${ad.id} · ${ad.description || "—"}`));
    id.append(txt);
    const side = el("div", "adm-actions");
    side.append(badge(ad.enabled ? "enabled" : "disabled"));
    if (ad.sessionCount > 0) side.append(badge(`${ad.sessionCount} sessions`));
    side.append(
      button("Edit", "btn ghost adm-small", () => { editing = structuredClone(ad); renderBody(); }),
      button("Delete", "btn ghost adm-small adm-danger", () => confirmDelete(
        `Delete adventure "${ad.name}" (${ad.id})?`, () => deleteAdventure(ad.id), "Adventure deleted")),
    );
    row.append(id, side);
    els.body.appendChild(row);
  }
}

function adventureForm(ad) {
  const form = el("div", "adm-form");
  form.appendChild(el("h4", null, ad.isNew ? "New adventure" : `Edit adventure — ${ad.name}`));

  const f = {
    id: textInput(ad.id, "ad_my_route"),
    name: textInput(ad.name),
    description: textInput(ad.description ?? "", "optional"),
    enabled: el("input"),
    config: el("textarea"),
  };
  f.id.disabled = !ad.isNew;
  f.enabled.type = "checkbox";
  f.enabled.checked = ad.enabled !== false;
  f.config.rows = 14;
  f.config.spellcheck = false;
  f.config.value = JSON.stringify(ad.config, null, 2);

  const grid = el("div", "adm-grid");
  grid.append(field("Id (permanent)", f.id), field("Name", f.name),
    field("Description", f.description), field("Enabled", f.enabled));

  const configField = field("Config (JSON)", f.config);
  configField.classList.add("adm-wide");

  form.append(grid,
    configField, el("p", "adm-hint", ADVENTURE_CONFIG_HINT),
    formButtons(() => {
      let config;
      try {
        config = JSON.parse(f.config.value);
      } catch {
        throw new Error("Config is not valid JSON — fix the syntax and save again");
      }
      return saveAdventure({
        id: f.id.value.trim(), name: f.name.value.trim(),
        description: f.description.value.trim() || null,
        config, enabled: f.enabled.checked,
      });
    }, "Adventure saved"));
  els.body.appendChild(form);
}

// ---------- tournaments (Phase 9.2) ----------
//
// Unlike every other tab above, this one reads its OWN endpoint
// (GET /api/admin/tournaments) rather than folding into `data`'s
// masterState — tournaments are admin-created INSTANCE data (one-off
// scheduled events), not reusable master content the rest of the console
// edits. Its own `tournamentsData`/`creatingTournament` state stays separate
// from `data`/`editing` so a tournament mutation can never clobber the
// master tables' cached state (mutate()/formButtons() are deliberately NOT
// reused here for that reason).

const TOURNAMENT_REWARDS_HINT =
  'rewards (JSON) — {positionRewards:{"1":[...],"2":[...],"3":[...]}, ' +
  'percentileRewards:[{fromPct,toPct,rewards:[...]}, ...]}. A reward is ' +
  '{type:"gold",amount} | {type:"item",itemId,qty} | {type:"equipment",equipmentDefId} | ' +
  '{type:"rune",runeDefId} | {type:"monster",speciesId}. percentileRewards tiers must be ' +
  "ordered, contiguous, and cover 1-100 exactly, and every reward list (a position's or a " +
  'tier\'s) must be non-empty. Shape example: {"positionRewards":{"1":[{"type":"gold",' +
  '"amount":500}]},"percentileRewards":[{"fromPct":1,"toPct":100,"rewards":[]}]} — swap that ' +
  "empty [] for real rewards before saving.";

function tournamentsTab() {
  if (creatingTournament) return tournamentForm();
  els.body.appendChild(toolbar("＋ New tournament", () => { creatingTournament = true; renderBody(); }));

  if (!tournamentsData) {
    els.body.appendChild(el("p", "adm-hint", "Loading…"));
    loadTournaments()
      .then((res) => { tournamentsData = res.tournaments; renderBody(); })
      .catch((e) => pushMsg(`Could not load tournaments: ${e.message}`, true));
    return;
  }

  for (const t of tournamentsData) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    const txt = el("span");
    txt.append(el("b", null, t.name), el("small", null,
      `#${t.id} · ${fmtDate(t.regStartsAt)} – ${fmtDate(t.regEndsAt)} · entry fee ${t.entryFee} 🪙`));
    id.append(txt);

    const side = el("div", "adm-actions");
    side.append(badge(t.status), badge(`${t.entrantCount} entered`));
    if (t.status !== "completed" && t.status !== "cancelled") {
      side.append(button("Cancel", "btn ghost adm-small adm-danger", async () => {
        if (!window.confirm(
          `Cancel tournament "${t.name}"? Every entrant's monster locks are released and entry fees refunded.`
        )) return;
        els.msgs.innerHTML = "";
        try {
          await cancelTournament(t.id);
          tournamentsData = (await loadTournaments()).tournaments;
          renderBody();
          pushMsg("Tournament cancelled.");
        } catch (e) {
          pushMsg(e.message, true);
        }
      }));
    }
    row.append(id, side);
    els.body.appendChild(row);
  }
}

/** Local "YYYY-MM-DDTHH:mm" for a <input type="datetime-local"> default —
 *  new Date(localString) below reads it back as local time, same round trip. */
function toDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function tournamentForm() {
  const form = el("div", "adm-form");
  form.appendChild(el("h4", null, "New tournament"));

  const now = Date.now();
  const f = {
    name: textInput("", "Summer Cup"),
    description: textInput("", "optional"),
    entryFee: numInput(0, 0, 1_000_000),
    regStartsAt: el("input"),
    regEndsAt: el("input"),
    rewards: el("textarea"),
  };
  f.regStartsAt.type = "datetime-local";
  f.regStartsAt.value = toDatetimeLocal(new Date(now + 60 * 60 * 1000)); // +1h
  f.regEndsAt.type = "datetime-local";
  f.regEndsAt.value = toDatetimeLocal(new Date(now + 25 * 60 * 60 * 1000)); // +25h
  f.rewards.rows = 8;
  f.rewards.spellcheck = false;
  f.rewards.value = JSON.stringify({
    positionRewards: { 1: [{ type: "gold", amount: 500 }] },
    percentileRewards: [{ fromPct: 1, toPct: 100, rewards: [{ type: "gold", amount: 10 }] }],
  }, null, 2);

  const grid = el("div", "adm-grid");
  grid.append(
    field("Name", f.name), field("Description", f.description),
    field("Entry fee (gold)", f.entryFee),
    field("Registration starts", f.regStartsAt), field("Registration ends", f.regEndsAt),
  );

  const rewardsField = field("Rewards (JSON)", f.rewards);
  rewardsField.classList.add("adm-wide");

  form.append(grid, rewardsField, el("p", "adm-hint", TOURNAMENT_REWARDS_HINT),
    tournamentFormButtons(() => {
      // Client-side checks stay minimal (well-formed JSON, the fields the
      // server can't sensibly default) — the server is the real validator
      // (validateTournament, CLAUDE.md §1.1).
      let rewards;
      try {
        rewards = JSON.parse(f.rewards.value);
      } catch {
        throw new Error("Rewards is not valid JSON — fix the syntax and save again");
      }
      if (!f.name.value.trim()) throw new Error("Name is required");
      if (!f.regStartsAt.value || !f.regEndsAt.value) throw new Error("Both registration dates are required");
      return createTournament({
        name: f.name.value.trim(),
        description: f.description.value.trim() || undefined,
        entryFee: +f.entryFee.value,
        regStartsAt: new Date(f.regStartsAt.value).toISOString(),
        regEndsAt: new Date(f.regEndsAt.value).toISOString(),
        rewards,
      });
    }, "Tournament created"));
  els.body.appendChild(form);
}

/** Same shape as formButtons() but re-reads tournamentsData (the tab's OWN
 *  list, not the shared masterState) after a win — mutate()/formButtons()
 *  are for the master tables only. */
function tournamentFormButtons(save, okText) {
  const bar = el("div", "adm-toolbar");
  const saveBtn = button("Save", "btn primary adm-small", async () => {
    saveBtn.disabled = true;
    els.msgs.innerHTML = "";
    try {
      await save();
      tournamentsData = (await loadTournaments()).tournaments;
      creatingTournament = false;
      renderBody();
      pushMsg(okText);
    } catch (e) {
      pushMsg(e.message, true);
      saveBtn.disabled = false;
    }
  });
  bar.append(saveBtn, button("Cancel", "btn ghost adm-small", () => { creatingTournament = false; renderBody(); }));
  return bar;
}

// ---------- GVG events (Phase 9.5) ----------
//
// Same reasoning as the tournaments tab above: this reads its OWN endpoint
// (GET /api/admin/gvg) rather than folding into `data`'s masterState — GVG
// events are admin-created INSTANCE data (one-off scheduled events), not
// reusable master content the rest of the console edits. Its own
// `gvgData`/`creatingGvg` state stays separate from `data`/`editing` so a
// GVG mutation can never clobber the master tables' cached state
// (mutate()/formButtons() are deliberately NOT reused here for that reason).

const GVG_REWARDS_HINT =
  'rewards (JSON) — {positionRewards:{"1":[...],"2":[...],"3":[...]}, ' +
  'percentileRewards:[{fromPct,toPct,rewards:[...]}, ...]}. A reward is ' +
  '{type:"gold",amount} | {type:"item",itemId,qty} | {type:"equipment",equipmentDefId} | ' +
  '{type:"rune",runeDefId} | {type:"monster",speciesId}. percentileRewards tiers must be ' +
  "ordered, contiguous, and cover 1-100 exactly, and every reward list (a position's or a " +
  'tier\'s) must be non-empty. Shape example: {"positionRewards":{"1":[{"type":"gold",' +
  '"amount":500}]},"percentileRewards":[{"fromPct":1,"toPct":100,"rewards":[]}]} — swap that ' +
  "empty [] for real rewards before saving.";

function gvgTab() {
  if (creatingGvg) return gvgForm();
  els.body.appendChild(toolbar("＋ New GVG event", () => { creatingGvg = true; renderBody(); }));

  if (!gvgData) {
    els.body.appendChild(el("p", "adm-hint", "Loading…"));
    loadGvgEvents()
      .then((res) => { gvgData = res.events; renderBody(); })
      .catch((e) => pushMsg(`Could not load GVG events: ${e.message}`, true));
    return;
  }

  for (const e of gvgData) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    const txt = el("span");
    txt.append(el("b", null, e.name), el("small", null,
      `#${e.id} · ${fmtDate(e.regStartsAt)} – ${fmtDate(e.regEndsAt)} · ${e.minTeams}-${e.maxTeams} teams`));
    id.append(txt);

    const side = el("div", "adm-actions");
    side.append(badge(e.status), badge(`${e.registeredGuildCount} guild${e.registeredGuildCount === 1 ? "" : "s"} registered`));
    if (e.status !== "completed" && e.status !== "cancelled") {
      side.append(button("Cancel", "btn ghost adm-small adm-danger", async () => {
        if (!window.confirm(
          `Cancel GVG event "${e.name}"? Every submitted team's monster locks are released.`
        )) return;
        els.msgs.innerHTML = "";
        try {
          await cancelGvgEvent(e.id);
          gvgData = (await loadGvgEvents()).events;
          renderBody();
          pushMsg("GVG event cancelled.");
        } catch (err) {
          pushMsg(err.message, true);
        }
      }));
    }
    row.append(id, side);
    els.body.appendChild(row);
  }
}

function gvgForm() {
  const form = el("div", "adm-form");
  form.appendChild(el("h4", null, "New GVG event"));

  const now = Date.now();
  const f = {
    name: textInput("", "Guild Clash"),
    description: textInput("", "optional"),
    minTeams: numInput(1, 1, 10),
    maxTeams: numInput(10, 1, 10),
    regStartsAt: el("input"),
    regEndsAt: el("input"),
    rewards: el("textarea"),
  };
  f.regStartsAt.type = "datetime-local";
  f.regStartsAt.value = toDatetimeLocal(new Date(now + 60 * 60 * 1000)); // +1h
  f.regEndsAt.type = "datetime-local";
  f.regEndsAt.value = toDatetimeLocal(new Date(now + 25 * 60 * 60 * 1000)); // +25h
  f.rewards.rows = 8;
  f.rewards.spellcheck = false;
  f.rewards.value = JSON.stringify({
    positionRewards: { 1: [{ type: "gold", amount: 500 }] },
    percentileRewards: [{ fromPct: 1, toPct: 100, rewards: [{ type: "gold", amount: 10 }] }],
  }, null, 2);

  const grid = el("div", "adm-grid");
  grid.append(
    field("Name", f.name), field("Description", f.description),
    field("Min teams", f.minTeams), field("Max teams", f.maxTeams),
    field("Registration starts", f.regStartsAt), field("Registration ends", f.regEndsAt),
  );

  const rewardsField = field("Rewards (JSON)", f.rewards);
  rewardsField.classList.add("adm-wide");

  form.append(grid, rewardsField, el("p", "adm-hint", GVG_REWARDS_HINT),
    gvgFormButtons(() => {
      // Client-side checks stay minimal (well-formed JSON, the fields the
      // server can't sensibly default) — the server is the real validator
      // (validateGvgEvent, CLAUDE.md §1.1).
      let rewards;
      try {
        rewards = JSON.parse(f.rewards.value);
      } catch {
        throw new Error("Rewards is not valid JSON — fix the syntax and save again");
      }
      if (!f.name.value.trim()) throw new Error("Name is required");
      if (!f.regStartsAt.value || !f.regEndsAt.value) throw new Error("Both registration dates are required");
      return createGvgEvent({
        name: f.name.value.trim(),
        description: f.description.value.trim() || undefined,
        minTeams: +f.minTeams.value,
        maxTeams: +f.maxTeams.value,
        regStartsAt: new Date(f.regStartsAt.value).toISOString(),
        regEndsAt: new Date(f.regEndsAt.value).toISOString(),
        rewards,
      });
    }, "GVG event created"));
  els.body.appendChild(form);
}

/** Same shape as tournamentFormButtons() but re-reads gvgData (this tab's OWN
 *  list, not the shared masterState) after a win. */
function gvgFormButtons(save, okText) {
  const bar = el("div", "adm-toolbar");
  const saveBtn = button("Save", "btn primary adm-small", async () => {
    saveBtn.disabled = true;
    els.msgs.innerHTML = "";
    try {
      await save();
      gvgData = (await loadGvgEvents()).events;
      creatingGvg = false;
      renderBody();
      pushMsg(okText);
    } catch (e) {
      pushMsg(e.message, true);
      saveBtn.disabled = false;
    }
  });
  bar.append(saveBtn, button("Cancel", "btn ghost adm-small", () => { creatingGvg = false; renderBody(); }));
  return bar;
}

// ---------- trainers (roster browser + monster minting) ----------

function trainersTab() {
  if (managing) return trainerDetail(managing);

  if (!trainers) {
    els.body.appendChild(el("p", "adm-hint", "Loading…"));
    loadTrainers()
      .then((res) => { trainers = res.trainers; renderBody(); })
      .catch((e) => pushMsg(`Could not load trainers: ${e.message}`, true));
    return;
  }

  for (const t of trainers) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    const txt = el("span");
    txt.append(el("b", null, t.name), el("small", null, `${t.email} · #${t.id}`));
    id.append(txt);
    const side = el("div", "adm-actions");
    side.append(badge(`${t.gold} 🪙`), badge(`${t.exp} ⭐`), badge(`${t.monsterCount} monsters`));
    if (t.isAdmin) side.append(badge("ADMIN"));
    side.append(button("Manage", "btn ghost adm-small", () => manageTrainer(t.id)));
    row.append(id, side);
    els.body.appendChild(row);
  }
}

async function manageTrainer(trainerId) {
  els.msgs.innerHTML = "";
  pendingRemove = null;
  try {
    managing = await loadTrainerMonsters(trainerId);
    renderBody();
  } catch (e) {
    pushMsg(e.message, true);
  }
}

function trainerDetail({ trainer, monsters, unassigned }) {
  const bar = el("div", "adm-toolbar");
  bar.appendChild(button("← All trainers", "btn ghost adm-small", () => {
    managing = null;
    pendingRemove = null;
    trainers = null; // invalidate the cached list so monster counts refresh
    renderBody();
  }));
  els.body.appendChild(bar);

  const header = el("div", "adm-row");
  const headId = el("div", "adm-id");
  headId.append(el("b", null, trainer.name), el("small", null, trainer.email));
  const headSide = el("div", "adm-actions");
  // Inline gold editor (Phase 10.1): an admin states the ABSOLUTE balance,
  // unlike the grant flow's relative credit — prefilled with the current
  // value, "Set gold" posts it straight to /api/admin/trainers/update.
  const goldInput = numInput(trainer.gold, 0);
  headSide.append(
    field("Gold", goldInput),
    button("Set gold", "btn ghost adm-small", async () => {
      pendingRemove = null;
      els.msgs.innerHTML = "";
      const gold = Number(goldInput.value);
      if (goldInput.value === "" || Number.isNaN(gold)) {
        pushMsg("enter a gold amount", true);
        return;
      }
      try {
        const res = await updateTrainer({ trainerId: trainer.id, gold });
        managing = { ...managing, trainer: res.trainer };
        renderBody();
        pushMsg(`Set ${res.trainer.name}'s gold to ${res.trainer.gold}.`);
        refreshProfile(); // fire-and-forget, mirrors gold shown by farm.js's showProfile()
      } catch (e) {
        pushMsg(e.message, true);
      }
    }),
    badge(`${trainer.exp} ⭐`),
  );
  header.append(headId, headSide);
  els.body.appendChild(header);

  // Mint control: pick any species from the master list, mint one instance
  // for this trainer — the same mintMonster() the Summon Hall's pull uses.
  els.body.appendChild(el("p", "adm-hint", "Mint new from species"));
  const speciesSelect = selectInput(
    data.species.map((s) => [s.id, `${s.emoji} ${s.name} (${s.id})`]),
    data.species[0]?.id,
  );
  const mintBar = el("div", "adm-toolbar");
  mintBar.append(
    field("Species", speciesSelect),
    button("Mint monster", "btn primary adm-small", async () => {
      pendingRemove = null;
      els.msgs.innerHTML = "";
      try {
        const res = await mintMonsterFor({ trainerId: trainer.id, speciesId: speciesSelect.value });
        managing = { trainer: res.trainer, monsters: res.monsters, unassigned: res.unassigned };
        renderBody();
        pushMsg(`Minted "${res.monster.name}" for ${res.trainer.name}.`);
      } catch (e) {
        pushMsg(e.message, true);
      }
    }),
  );
  els.body.appendChild(mintBar);

  // Attach control: link an already-minted but ownerless monster (detached
  // from some other account, growth intact) to this one instead of minting
  // a fresh instance.
  els.body.appendChild(el("p", "adm-hint", "Attach existing unassigned monster"));
  if (!unassigned.length) {
    els.body.appendChild(el("p", "adm-hint",
      "No unassigned monsters — remove one from an account and it will appear here."));
  } else {
    const unassignedSelect = selectInput(
      unassigned.map((m) => [m.id, `${m.emoji} ${m.name} · ${m.speciesId} · #${m.id}`]),
      unassigned[0].id,
    );
    const attachBar = el("div", "adm-toolbar");
    attachBar.append(
      field("Monster", unassignedSelect),
      button("Attach", "btn primary adm-small", async () => {
        pendingRemove = null;
        els.msgs.innerHTML = "";
        try {
          const res = await attachMonsterTo({
            trainerId: trainer.id, monsterId: Number(unassignedSelect.value),
          });
          managing = { trainer: res.trainer, monsters: res.monsters, unassigned: res.unassigned };
          renderBody();
          pushMsg(`Attached "${res.monster.name}" to ${res.trainer.name}.`);
        } catch (e) {
          pushMsg(e.message, true);
        }
      }),
    );
    els.body.appendChild(attachBar);
  }

  for (const m of monsters) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    id.append(spritePreview(m.sprite, m.emoji));
    const txt = el("span");
    txt.append(el("b", null, m.name), el("small", null, `${m.speciesId} · #${m.id}`));
    id.append(txt);
    const side = el("div", "adm-actions");
    side.append(
      badge(`HP ${m.base.hp}`), badge(`ATK ${m.base.atk}`), badge(`SPD ${m.base.spd}`),
      ...Object.keys(ATTR_LABEL).map((a) => badge(`${ATTR_LABEL[a]} ${m.attrs[a]}`)),
    );
    if (m.busyUntil && new Date(m.busyUntil) > new Date()) side.append(badge(`busy: ${m.busyKind}`));

    // Inline rank editor (Phase 10.9): changes post straight to
    // /api/admin/monsters/update and re-render from the fresh payload, same
    // idiom as the header's gold editor.
    const rankSelect = selectInput(data.enums.ranks, m.rank ?? "D");
    rankSelect.addEventListener("change", async () => {
      pendingRemove = null;
      els.msgs.innerHTML = "";
      try {
        const res = await updateMonster({
          trainerId: trainer.id, monsterId: m.id, rank: rankSelect.value,
        });
        managing = { trainer: res.trainer, monsters: res.monsters, unassigned: res.unassigned };
        renderBody();
        pushMsg(`Set "${m.name}"'s rank to ${rankSelect.value}.`);
      } catch (e) {
        pushMsg(e.message, true);
      }
    });
    side.append(rankSelect);

    // Detach ("Remove"): an inline two-step confirm, same idiom as
    // ui/trainer.js's expertise-switch warning — first click arms it and
    // warns via pushMsg, second click actually detaches. Anything else that
    // re-renders (another row's Remove, mint, attach, navigating away)
    // disarms it since pendingRemove is a single module-level value.
    side.append(button(
      pendingRemove === m.id ? "⚠ Confirm remove" : "Remove",
      "btn ghost adm-small",
      async () => {
        if (pendingRemove !== m.id) {
          pendingRemove = m.id;
          renderBody();
          els.msgs.innerHTML = "";
          pushMsg(
            `Removing "${m.name}": its training and skills stay on the monster, but it ` +
            `becomes INACTIVE and unlinked from ${trainer.name}; equipped gear and runes ` +
            "return to the bag. Click again to confirm.",
          );
          return;
        }
        els.msgs.innerHTML = "";
        try {
          const res = await detachMonsterFrom({ trainerId: trainer.id, monsterId: m.id });
          pendingRemove = null;
          managing = { trainer: res.trainer, monsters: res.monsters, unassigned: res.unassigned };
          renderBody();
          pushMsg(`Removed "${m.name}" from ${res.trainer.name}.`);
        } catch (e) {
          pendingRemove = null;
          renderBody(); // un-arm the button even though the row itself didn't change
          pushMsg(e.message, true);
        }
      },
    ));

    row.append(id, side);
    els.body.appendChild(row);
  }
}

// ---------- sprites (read-only gallery) ----------

function spritesTab() {
  els.body.appendChild(el("p", "adm-hint",
    "Sprites are files in the repo, not DB rows: drop a PNG in public/sprites/units/, " +
    "add an entry in src/data/sprites.js, then pick it on a species here. " +
    "Portraits are authored on a solid #FF007F background (keyed out at load); " +
    "sheets follow public/sprites/TEMPLATE.md (96px cells, idle/attack/defend/dead × 4 frames)."));

  const gallery = el("div", "adm-gallery");
  for (const [id, def] of Object.entries(SPRITES)) {
    const card = el("div", "adm-card");
    card.append(spritePreview(id, null, 96));
    card.append(el("b", null, id));
    card.append(el("small", null, def.img
      ? `portrait · ${def.img}`
      : `sheet · ${def.cell}px × ${def.cols} frames · ${Object.keys(def.actions).join("/")}`));
    const users = data.species.filter((s) => s.sprite === id);
    card.append(el("small", "adm-users",
      users.length ? "used by " + users.map((s) => s.name).join(", ") : "unused"));
    gallery.appendChild(card);
  }
  els.body.appendChild(gallery);
}

// ---------- statuses (read-only reference) ----------

/** Statuses are the engine's CLOSED registry (shared/rules/statuses.js) —
 *  unlike every other tab here, this one is never editable: a new status
 *  needs an engine-side rules entry, not a DB row. This tab exists purely so
 *  an admin can see the id/label/icon-file mapping in one place. */
function statusesTab() {
  els.body.appendChild(el("p", "adm-hint",
    "Statuses are the engine's closed registry (shared/rules/statuses.js) — they are " +
    "never DB rows, so there is nothing to edit here. Their icon filenames are mapped " +
    "in src/data/statusIcons.js and the art lives in public/icons/statuses/: swap art by " +
    "replacing the PNG, repoint a status at different art by editing that map."));

  for (const [id, s] of Object.entries(STATUSES)) {
    const row = el("div", "adm-row");
    const idCol = el("div", "adm-id");
    const base = STATUS_ICONS[id] || id;
    const img = el("img", "adm-thumb");
    img.width = 28;
    img.height = 28;
    img.alt = s.label;
    img.title = s.label;
    img.src = `/icons/statuses/${base}.png`;
    img.onerror = () => {
      img.onerror = null; // guard: a missing default.png must not loop
      img.src = "/icons/statuses/default.png";
    };
    idCol.append(img);
    const txt = el("span");
    txt.append(el("b", null, s.label), el("small", null, `${id} · icon file ${base}.png`));
    idCol.append(txt);
    row.append(idCol);
    els.body.appendChild(row);
  }
}

// ---------- shared form plumbing ----------

function formButtons(save, okText) {
  const bar = el("div", "adm-toolbar");
  const saveBtn = button("Save", "btn primary adm-small", async () => {
    saveBtn.disabled = true;
    try {
      await mutate(() => save(), okText);
    } catch (e) {
      pushMsg(e.message, true); // client-side pre-checks (e.g. bad JSON)
    } finally {
      saveBtn.disabled = false;
    }
  });
  bar.append(saveBtn, button("Cancel", "btn ghost adm-small", () => { editing = null; renderBody(); }));
  return bar;
}

function confirmDelete(question, doDelete, okText) {
  if (!window.confirm(question)) return;
  return mutate(doDelete, okText);
}

function fmtDur(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${+(s / 3600).toFixed(1)}h`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString();
}
