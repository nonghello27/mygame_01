// The scrolling battle log under the board.

let logLines;

export function initLog() {
  logLines = document.getElementById("logLines");
}

export function clearLog() {
  if (logLines) logLines.innerHTML = "";
}

/** Append a line. `sys` styles it as a system/event line (amber). */
export function log(html, sys = false) {
  const p = document.createElement("p");
  if (sys) p.className = "sys";
  p.innerHTML = html;
  logLines.appendChild(p);
  logLines.scrollTop = logLines.scrollHeight;
}

/** A faction-colored unit name for use inside log lines. */
export const nameSpan = (u, side) => `<span class="${side}">${u.name}</span>`;
