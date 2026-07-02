// Client I/O boundary for auth — the only place the app talks to /api/auth/*
// and /api/me. The session itself is an HttpOnly cookie the JS never sees;
// these calls just ride it (credentials are same-origin by default).

/** @returns the trainer, or null when not logged in / API unreachable. */
export async function fetchMe() {
  try {
    const r = await fetch("/api/me");
    if (!r.ok) return null;
    return (await r.json()).trainer;
  } catch {
    return null;
  }
}

/** Exchange a Firebase ID token for a session. @returns the trainer. */
export async function loginWithCredential(credential) {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "login failed");
  return data.trainer;
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
}
