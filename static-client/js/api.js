/**
 * api.js
 * Authenticated fetch wrapper, profile helpers, global auth UI.
 */
import { WORKER_API_BASE_URL } from "../config.js";
import { getAuthToken } from "./clerk-init.js";

// Shared Clerk instance — set by the page entry-point after init
let _clerk = null;

export function setClerk(c) {
  _clerk = c;
}

export function getClerk() {
  return _clerk;
}

// ── Utilities ──────────────────────────────────────────

function normalizeBase(url) {
  return (url || "").replace(/\/+$/, "");
}

export function getErrorMessage(error, fallback = "Request failed") {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  const clerkErrors = error?.errors;
  if (Array.isArray(clerkErrors) && clerkErrors.length) {
    const first = clerkErrors[0];
    const code = first?.code ? ` (${first.code})` : "";
    return (first?.longMessage || first?.message || fallback) + code;
  }
  return error?.message || fallback;
}

// ── API fetch ──────────────────────────────────────────

export async function apiFetch(path, options = {}) {
  const base = normalizeBase(WORKER_API_BASE_URL);
  if (!base) throw new Error("Missing WORKER_API_BASE_URL in config.js");

  const token = await getAuthToken(_clerk);
  if (!token) throw new Error("Not authenticated");

  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    let detail = "";
    try {
      const payload = await response.json();
      message = payload?.error || payload?.message || message;
      detail = payload?.detail || "";
    } catch { /* no-op */ }

    if (response.status === 401) {
      const msg = detail ? `Unauthorized: ${detail}` : "Unauthorized";
      console.error(`[apiFetch] 401 on ${path} — ${msg}`);
      throw new Error(msg);
    }
    throw new Error(message);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

// ── Profile / identity ─────────────────────────────────

export function getCurrentUserIdentity() {
  const user = _clerk?.user;
  if (!user) return { username: "", email: "" };
  const email =
    user.primaryEmailAddress?.emailAddress ||
    user.emailAddresses?.[0]?.emailAddress || "";
  const username =
    user.username || user.firstName || (email ? email.split("@")[0] : "");
  return { username, email };
}

export async function ensureProfile() {
  const { username, email } = getCurrentUserIdentity();
  await apiFetch("/api/profile/ensure", {
    method: "POST",
    body: { username, email },
  });
}

// ── Global auth UI ─────────────────────────────────────

export function setGlobalAuthUi(isSignedIn, displayName = "") {
  const whoamiEl      = document.getElementById("whoami");
  const logoutBtn     = document.getElementById("logout-btn");
  const signinLink    = document.getElementById("signin-top-link");
  const signedOutPanel = document.getElementById("signed-out-panel");
  const appPanel      = document.getElementById("app");

  if (whoamiEl)       whoamiEl.textContent = isSignedIn && displayName ? `Signed in as ${displayName}` : "";
  if (logoutBtn)      logoutBtn.classList.toggle("hidden", !isSignedIn);
  if (signinLink)     signinLink.classList.toggle("hidden", isSignedIn);
  if (signedOutPanel) signedOutPanel.classList.toggle("hidden", isSignedIn);
  if (appPanel)       appPanel.classList.toggle("hidden", !isSignedIn);
}

// ── Status line ────────────────────────────────────────

export function showStatus(message, isError = false) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = message || "";
  el.style.color = isError ? "#dc3545" : "";
}

export function showAuthError(message) {
  const el = document.getElementById("auth-error");
  if (!el) return;
  if (!message) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  el.textContent = message;
  el.classList.remove("hidden");
}
