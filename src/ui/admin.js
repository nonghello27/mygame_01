// Admin console (Phase 5): sub-menu tabs over the master tables — Species,
// Skills, Classes, Jobs — plus a read-only Sprites gallery. Pure presentation
// over /api/admin/*: every dropdown is built from the enums the SERVER sent
// (so options can't drift from the engine), every save posts a proposed row
// and re-renders the fresh masterState the server responds with, and every
// image (sprite portrait, sheet frame, emoji fallback) is shown as an image.
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
} from "../services/admin.js";
import { SPRITES } from "../data/sprites.js";
import { chromaKeyed } from "./chroma.js";

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
  ["sprites", "🖼 Sprites"],
];

const ATTR_LABEL = { str: "STR", agi: "AGI", vit: "VIT", int: "INT", dex: "DEX" };

let els = null;
let data = null;    // last masterState from the server
let tab = "species";
let editing = null; // row being edited in the current tab (null = list view)

export function initAdmin() {
  els = {
    btn: document.getElementById("adminBtn"),
    panel: document.getElementById("adminPanel"),
    tabs: document.getElementById("adminTabs"),
    msgs: document.getElementById("adminMsgs"),
    body: document.getElementById("adminBody"),
  };
  els.btn.addEventListener("click", toggle);
}

/** Called by ui/auth.js whenever the trainer profile is (re)shown. */
export function setAdminVisible(isAdmin) {
  if (els) els.btn.hidden = !isAdmin;
}

async function toggle() {
  const opening = els.panel.hidden;
  els.panel.hidden = !opening;
  els.btn.textContent = opening ? "⚙ Close Admin" : "⚙ Admin";
  if (opening) await refresh();
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
    summons: summonsTab, adventures: adventuresTab, sprites: spritesTab,
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
    starter: false, element: "neutral", attackKind: "melee", attackStyle: "phys",
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
    field("Element", f.element), field("Attack kind", f.attackKind),
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
    speciesUses: 0, monsterUses: 0, isNew: true,
  })));

  for (const k of data.skills) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
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
    data: el("textarea"),
  };
  f.id.disabled = !k.isNew;
  f.data.rows = 8;
  f.data.spellcheck = false;
  f.data.value = JSON.stringify(k.data, null, 2);

  const grid = el("div", "adm-grid");
  grid.append(field("Id (permanent)", f.id), field("Name", f.name),
    field("Slot", f.slot), field("Cooldown (turns)", f.cooldown));

  const dataField = field("Data (JSON — the engine's closed grammar)", f.data);
  dataField.classList.add("adm-wide");

  form.append(grid, dataField, el("p", "adm-hint", SKILL_DATA_HINT),
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
      });
    }, "Skill saved"));
  els.body.appendChild(form);
}

// ---------- classes ----------

function classesTab() {
  if (editing) return classForm(editing);
  els.body.appendChild(toolbar("＋ New class", () => ({ cls: "", attackName: "", fx: "", speciesCount: 0, isNew: true })));

  for (const c of data.classes) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
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

function classForm(c) {
  const form = el("div", "adm-form");
  form.appendChild(el("h4", null, c.isNew ? "New class" : `Edit class — ${c.cls}`));
  const f = {
    cls: textInput(c.cls, "Knight"),
    attackName: textInput(c.attackName, "Blade Arc"),
    fx: textInput(c.fx, "slash"),
  };
  f.cls.disabled = !c.isNew;
  const grid = el("div", "adm-grid");
  grid.append(field("Class (permanent)", f.cls), field("Attack name", f.attackName), field("Fx id", f.fx));
  form.append(grid,
    el("p", "adm-hint",
      "A brand-new fx id also needs a portrait case in cutscene/portraits.js and " +
      "keyframes in styles/cutscene.css — until then the cutscene falls back to a plain hit."),
    formButtons(() => saveClass({
      cls: f.cls.value.trim(), attackName: f.attackName.value.trim(), fx: f.fx.value.trim(),
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
    ownedCount: 0, isNew: true,
  })));

  for (const it of data.itemDefs) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    const txt = el("span");
    txt.append(el("b", null, it.name), el("small", null, `${it.id} · ${it.description || "—"}`));
    id.append(txt);
    const side = el("div", "adm-actions");
    side.append(badge(it.kind));
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
  };
  f.id.disabled = !it.isNew;

  const grid = el("div", "adm-grid");
  grid.append(field("Id (permanent)", f.id), field("Kind", f.kind),
    field("Name", f.name), field("Description", f.description));

  form.append(grid, formButtons(() => saveItem({
    id: f.id.value.trim(), kind: f.kind.value,
    name: f.name.value.trim(), description: f.description.value.trim() || null,
  }), "Item saved"));
  els.body.appendChild(form);
}

function equipmentTab() {
  if (editing) return equipmentForm(editing);
  els.body.appendChild(toolbar("＋ New equipment", () => {
    const domain = data.enums.equipDomains[0] ?? "monster";
    return {
      id: "", domain, slot: data.enums.equipSlots[domain]?.[0] ?? "",
      name: "", description: "",
      effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 10, perLevel: 2 }],
      enhance: { maxLevel: 5, goldPerLevel: 50 },
      trainerOwned: 0, monsterOwned: 0, isNew: true,
    };
  }));

  for (const eq of data.equipmentDefs) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    const txt = el("span");
    txt.append(el("b", null, eq.name), el("small", null, `${eq.id} · ${eq.description || "—"}`));
    id.append(txt);
    const side = el("div", "adm-actions");
    side.append(badge(`${eq.domain} · ${eq.slot}`));
    if (eq.enhance) side.append(badge(`up to +${eq.enhance.maxLevel}`));
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
    effects: el("textarea"),
    enhanced: el("input"),
    maxLevel: numInput(eq.enhance?.maxLevel ?? 5, 1, 20),
    goldPerLevel: numInput(eq.enhance?.goldPerLevel ?? 50, 1, 1_000_000),
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

  const grid = el("div", "adm-grid");
  grid.append(field("Id (permanent)", f.id), field("Domain", f.domain), field("Slot", f.slot),
    field("Name", f.name), field("Description", f.description));

  const effectsField = field("Effects (JSON)", f.effects);
  effectsField.classList.add("adm-wide");

  const enhanceGrid = el("div", "adm-grid");
  const paintEnhance = () => {
    enhanceGrid.innerHTML = "";
    if (f.enhanced.checked) enhanceGrid.append(field("Max level", f.maxLevel), field("Gold per level", f.goldPerLevel));
  };
  f.enhanced.addEventListener("change", paintEnhance);
  paintEnhance();

  form.append(grid, effectsField, el("p", "adm-hint", EFFECTS_HINT),
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
        effects,
        enhance: f.enhanced.checked
          ? { maxLevel: +f.maxLevel.value, goldPerLevel: +f.goldPerLevel.value }
          : null,
      });
    }, "Equipment saved"));
  els.body.appendChild(form);
}

function runesTab() {
  if (editing) return runeForm(editing);
  els.body.appendChild(toolbar("＋ New rune", () => ({
    id: "", name: "", description: "",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "spd", flat: 2, perLevel: 1 }],
    maxCharges: 5, repairGold: 30, ownedCount: 0, isNew: true,
  })));

  for (const rn of data.runeDefs) {
    const row = el("div", "adm-row");
    const id = el("div", "adm-id");
    const txt = el("span");
    txt.append(el("b", null, rn.name), el("small", null, `${rn.id} · ${rn.description || "—"}`));
    id.append(txt);
    const side = el("div", "adm-actions");
    side.append(badge(`${rn.maxCharges} charges`), badge(`repair ${rn.repairGold} 🪙`));
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
    effects: el("textarea"),
    maxCharges: numInput(rn.maxCharges, 1, 100),
    repairGold: numInput(rn.repairGold, 0, 1_000_000),
  };
  f.id.disabled = !rn.isNew;
  f.effects.rows = 6;
  f.effects.spellcheck = false;
  f.effects.value = JSON.stringify(rn.effects, null, 2);

  const grid = el("div", "adm-grid");
  grid.append(field("Id (permanent)", f.id), field("Name", f.name), field("Description", f.description),
    field("Max charges", f.maxCharges), field("Repair gold", f.repairGold));

  const effectsField = field("Effects (JSON)", f.effects);
  effectsField.classList.add("adm-wide");

  form.append(grid, effectsField, el("p", "adm-hint", EFFECTS_HINT),
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
        effects, maxCharges: +f.maxCharges.value, repairGold: +f.repairGold.value,
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
