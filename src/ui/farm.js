// Farm / Monster HQ panel: assign monsters to work or training jobs, watch
// the countdowns, collect what finished. Pure presentation — every number
// (duration, gold, attribute gain) comes from the server, and "collect" is
// just a re-read: the server settles finished jobs on any authenticated read
// (lazy time), this panel merely shows what that read paid out.

import { loadFarm, startJob } from "../services/content.js";
import { showProfile } from "./auth.js";
import { registerView } from "./views.js";

const ATTR_LABEL = { str: "STR", agi: "AGI", vit: "VIT", int: "INT", dex: "DEX" };

let els = null;
let data = null; // last farm state: { trainer, jobs, monsters, active }
let timer = null;

export function initFarm() {
  els = {
    panel: document.getElementById("farmPanel"),
    list: document.getElementById("farmList"),
    msgs: document.getElementById("farmMsgs"),
    btn: document.getElementById("farmBtn"),
  };
  registerView("farm", { button: els.btn, el: els.panel, onShow: onShowFarm });
}

/** Entering this view refreshes AND (re)starts the countdown ticker — the
 *  view registry (ui/views.js) has no "leaving" hook, only onShow, so the
 *  ticker is guarded against being started twice rather than ever
 *  explicitly stopped; it costs nothing to keep ticking while hidden. */
async function onShowFarm() {
  await refresh();
  if (!timer) timer = setInterval(tick, 1000);
}

/** Re-read the farm (which settles finished jobs server-side) and re-render. */
async function refresh() {
  try {
    apply(await loadFarm());
  } catch (e) {
    els.msgs.innerHTML = "";
    pushMsg(`Could not load the farm: ${e.message}`, true);
  }
}

function apply(next) {
  data = next;
  showProfile(data.trainer); // gold/exp chips reflect what settlement paid
  els.msgs.innerHTML = "";
  for (const s of data.settled) pushMsg(collectedText(s));
  render();
}

function collectedText(s) {
  const who = monsterName(s.monsterId);
  return s.kind === "work"
    ? `✅ ${who} finished ${s.jobName}: +${s.gold} 🪙, +${s.trainerExp} ⭐`
    : `✅ ${who} finished ${s.jobName}: +${s.gain} ${ATTR_LABEL[s.attr] ?? s.attr}`;
}

function monsterName(id) {
  return data?.monsters.find((m) => m.id === id)?.name ?? "A monster";
}

function pushMsg(text, isError = false) {
  const p = document.createElement("p");
  p.textContent = text;
  p.classList.toggle("err", isError);
  els.msgs.appendChild(p);
}

// ---------- rendering ----------

function render() {
  els.list.innerHTML = "";
  for (const m of data.monsters) {
    const row = document.createElement("div");
    row.className = "farm-row";
    row.append(identityCell(m), statusCell(m));
    els.list.appendChild(row);
  }
}

function identityCell(m) {
  const cell = document.createElement("div");
  cell.className = "farm-id";
  const attrs = Object.entries(m.attrs)
    .map(([k, v]) => `${ATTR_LABEL[k]} ${v}`)
    .join(" · ");
  cell.innerHTML = `<span class="farm-emoji">${m.emoji}</span>
    <span><b>${m.name}</b><small>${attrs}</small></span>`;
  return cell;
}

function statusCell(m) {
  const cell = document.createElement("div");
  cell.className = "farm-status";
  const activity = data.active.find((a) => a.monsterId === m.id);
  if (activity) {
    const verb = activity.kind === "work" ? "Working" : "Training";
    const label = document.createElement("span");
    label.className = "farm-doing";
    label.textContent = `${verb}: ${activity.jobName}`;
    cell.append(label, countdownEl(activity.endsAt));
  } else {
    cell.append(...assignControls(m));
  }
  return cell;
}

/** Countdown that turns into a Collect button when the job is done. */
function countdownEl(endsAt) {
  const el = document.createElement("span");
  el.className = "farm-count";
  el.dataset.ends = endsAt;
  paintCountdown(el);
  return el;
}

function paintCountdown(el) {
  const left = Math.ceil((new Date(el.dataset.ends) - Date.now()) / 1000);
  if (left > 0) {
    el.textContent = fmtLeft(left);
    return;
  }
  if (el.querySelector("button")) return; // already showing Collect
  el.textContent = "";
  const btn = document.createElement("button");
  btn.className = "btn ghost farm-btn";
  btn.textContent = "Collect";
  btn.addEventListener("click", refresh);
  el.appendChild(btn);
}

function tick() {
  for (const el of els.list.querySelectorAll(".farm-count")) paintCountdown(el);
}

function assignControls(m) {
  const select = document.createElement("select");
  select.className = "farm-select";
  for (const kind of ["work", "training"]) {
    const group = document.createElement("optgroup");
    group.label = kind === "work" ? "Work — earn gold" : "Training — grow an attribute";
    for (const j of data.jobs.filter((job) => job.kind === kind)) {
      const opt = document.createElement("option");
      opt.value = j.id;
      opt.textContent = `${j.name} · ${fmtDur(j.durationS)} · ${rewardText(j)}`;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }
  const btn = document.createElement("button");
  btn.className = "btn ghost farm-btn";
  btn.textContent = "Send";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      apply(await startJob(m.id, select.value));
    } catch (e) {
      pushMsg(`Could not start the job: ${e.message}`, true);
      btn.disabled = false;
    }
  });
  return [select, btn];
}

function rewardText(j) {
  return j.kind === "work"
    ? `+${j.rewards.gold} 🪙 +${j.rewards.trainerExp} ⭐`
    : `+${j.rewards.gain} ${ATTR_LABEL[j.rewards.attr] ?? j.rewards.attr}`;
}

function fmtDur(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${+(s / 3600).toFixed(1)}h`;
}

function fmtLeft(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}
