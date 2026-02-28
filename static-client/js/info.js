/**
 * js/info.js  —  Info page entry point
 *
 * Provides the full authenticated sidebar (lists + auth UI) on the info/about page.
 * No page-specific data is fetched — just auth + nav.
 */
import { initializeClerk } from "./clerk-init.js";
import {
  setClerk, apiFetch, ensureProfile, getCurrentUserIdentity,
  setGlobalAuthUi,
} from "./api.js";

// ── DOM refs ──────────────────────────────────────────
const logoutBtn    = document.getElementById("logout-btn");
const listsNavEl   = document.getElementById("lists");

// ── Mobile nav toggle ─────────────────────────────────
function initMobileNav() {
  const btn = document.getElementById("mobile-menu-btn");
  const navScrollable = document.querySelector(".nav-scrollable");
  btn?.addEventListener("click", () => {
    const isOpen = navScrollable?.classList.toggle("mobile-open");
    btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    btn.querySelector(".bi").className = `bi ${isOpen ? "bi-x-lg" : "bi-list"}`;
  });
}

// ── Nav (sidebar list) ────────────────────────────────
async function renderNav() {
  if (!listsNavEl) return;
  listsNavEl.innerHTML = "";

  let lists = [];
  try {
    const rows = await apiFetch("/api/lists");
    lists = Array.isArray(rows) ? rows : [];
  } catch { return; }

  for (const list of lists) {
    const item = document.createElement("div");
    item.className = "nav-item";

    const link = document.createElement("a");
    link.href = list.access_type === "invited"
      ? `./settings.html?listId=${list.id}`
      : `./index.html?listId=${list.id}`;
    link.className = "nav-link";

    const icon = document.createElement("span");
    icon.className = "bi bi-list-nested";
    icon.style.verticalAlign = "middle";
    link.append(icon, ` ${list.name}`);

    if (list.access_type === "invited") {
      const clock = document.createElement("span");
      clock.className = "bi bi-clock-fill pending-clock-icon";
      link.appendChild(clock);
    }

    item.appendChild(link);
    listsNavEl.appendChild(item);
  }

  // New List link
  const newItem = document.createElement("div");
  newItem.className = "nav-item";
  const newLink = document.createElement("a");
  newLink.href = "./index.html";
  newLink.className = "nav-link";
  newLink.innerHTML = `<span class="bi bi-plus-square-fill" style="vertical-align:middle;"></span> New List`;
  newItem.appendChild(newLink);
  listsNavEl.appendChild(newItem);
}

// ── Main ──────────────────────────────────────────────
async function main() {
  initMobileNav();

  try {
    const clerk = await initializeClerk();
    setClerk(clerk);

    if (!clerk.user) {
      setGlobalAuthUi(false);
      return;
    }

    const { username, email } = getCurrentUserIdentity();
    setGlobalAuthUi(true, username || email);

    logoutBtn?.addEventListener("click", async () => {
      await clerk.signOut();
      setGlobalAuthUi(false);
      window.location.href = "./index.html";
    });

    await ensureProfile();
    await renderNav();

    clerk.addListener(({ user }) => {
      if (!user) {
        setGlobalAuthUi(false);
        window.location.href = "./index.html";
      }
    });
  } catch (err) {
    console.error("[info] init failed:", err);
  }
}

void main();
