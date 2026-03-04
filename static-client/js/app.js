/**
 * js/app.js  —  Home page entry point
 *
 * Handles: Clerk init, nav rendering, list selection, movie loading,
 *          add-movie form with TMDB autocomplete, spotlight toggle.
 */
import { initializeClerk } from "./clerk-init.js";
import {
  setClerk, apiFetch, ensureProfile, getCurrentUserIdentity,
  setGlobalAuthUi, getErrorMessage, showStatus, showAuthError,
} from "./api.js";
import { setActiveListGetter, loadMovies, renderMovies } from "./movies.js";
import { initTmdbSearch, hideTmdbResults } from "./tmdb.js";

// ── DOM refs ──────────────────────────────────────────

const contentSurface    = document.getElementById("content-surface");
const logoutBtn         = document.getElementById("logout-btn");
const listsEl           = document.getElementById("lists");
const moviesEl          = document.getElementById("movies");
const titleRowEl        = document.getElementById("title-row");
const currentTitleEl    = document.getElementById("current-list-title");
const settingsLinkEl    = document.getElementById("settings-link");
const welcomeScreenEl   = document.getElementById("welcome-screen");
const welcomeHeadingEl  = document.getElementById("welcome-heading");
const welcomeSubEl      = document.getElementById("welcome-sub");
const listContentEl     = document.getElementById("list-content");
const addMovieForm      = document.getElementById("add-movie-form");
const movieTitleInput   = document.getElementById("movie-title-input");
const tmdbResultsEl     = document.getElementById("tmdb-results");

// ── State ─────────────────────────────────────────────
let clerk           = null;
let lists           = [];
let activeList      = null;
let appInitialized  = false;
let tmdbSelected    = null;

setActiveListGetter(() => activeList);

// ── Spotlight (always on) ────────────────────────────
function initSpotlightToggle() {
  contentSurface?.classList.remove("spotlight-off");
}
// ── Mobile nav toggle ─────────────────────────────
function initMobileNav() {
  const btn = document.getElementById("mobile-menu-btn");
  const navScrollable = document.querySelector(".nav-scrollable");
  btn?.addEventListener("click", () => {
    const isOpen = navScrollable?.classList.toggle("mobile-open");
    btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    btn.querySelector(".bi").className = `bi ${isOpen ? "bi-x-lg" : "bi-list"}`;
  });
}

export function closeMobileNav() {
  const btn = document.getElementById("mobile-menu-btn");
  const navScrollable = document.querySelector(".nav-scrollable");
  navScrollable?.classList.remove("mobile-open");
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
    const icon = btn.querySelector(".bi");
    if (icon) icon.className = "bi bi-list";
  }
}
// ── Nav rendering ─────────────────────────────────────
/**
 * Renders the list nav.
 * - Owned/shared lists: clickable button that calls selectList()
 * - Pending invites (access_type === "invited"): navigates to settings page
 * No delete/leave buttons — those live on the Settings page.
 */
function renderLists() {
  if (!listsEl) return;
  listsEl.innerHTML = "";

  for (const list of lists) {
    const item = document.createElement("div");
    item.className = "nav-item";

    if (list.access_type === "invited") {
      // Pending invite → navigate to settings page
      const link = document.createElement("a");
      link.className = "nav-link";
      link.href = `./settings.html?listId=${list.id}`;

      const icon = document.createElement("span");
      icon.className = "bi bi-list-nested";
      icon.style.verticalAlign = "middle";

      const name = document.createTextNode(` ${list.name}`);

      const clockIcon = document.createElement("span");
      clockIcon.className = "bi bi-clock-fill pending-clock-icon";
      clockIcon.title = "Pending invitation";

      link.append(icon, name, clockIcon);
      item.appendChild(link);
    } else {
      // Owner or shared — select list in-place
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-link" + (activeList?.id === list.id ? " active" : "");

      const icon = document.createElement("span");
      icon.className = "bi bi-list-nested";
      icon.style.verticalAlign = "middle";

      btn.append(icon, ` ${list.name}`);
      btn.addEventListener("click", () => selectList(list));
      item.appendChild(btn);
    }

    listsEl.appendChild(item);
  }

  // "New List" nav item — creates immediately and navigates to settings for naming
  const newItem = document.createElement("div");
  newItem.className = "nav-item";
  const newLink = document.createElement("button");
  newLink.type = "button";
  newLink.className = "nav-link";
  newLink.style.fontStyle = "normal";
  newLink.innerHTML = `<span class="bi bi-plus-square-fill" style="vertical-align:middle;"></span> New List`;
  newLink.addEventListener("click", async () => {
    try {
      const created = await apiFetch("/api/lists", {
        method: "POST",
        body: { name: "New List" },
      });
      window.location.href = `./settings.html?listId=${created.id}`;
    } catch (err) {
      showStatus(getErrorMessage(err, "Unable to create list"), true);
    }
  });
  newItem.appendChild(newLink);
  listsEl.appendChild(newItem);
}

// ── List controls ─────────────────────────────────────
function configureListControls() {
  if (currentTitleEl) {
    currentTitleEl.textContent = activeList?.name ?? "";
  }

  if (settingsLinkEl) {
    settingsLinkEl.href = activeList
      ? `./settings.html?listId=${activeList.id}`
      : "./settings.html";
  }

  const hasListSelected = !!activeList;

  welcomeScreenEl?.classList.toggle("hidden", hasListSelected);
  listContentEl?.classList.toggle("hidden", !hasListSelected);

  // Hide the add-movie form for non-owners on read-only lists.
  const canAdd = !activeList?.is_read_only || activeList?.access_type === 'owner';
  addMovieForm?.classList.toggle("hidden", !hasListSelected || !canAdd);

  if (!hasListSelected && moviesEl) moviesEl.innerHTML = "";
}

// ── Welcome screen state (no list selected) ───────────
function showWelcomeScreen(hasList) {
  if (!welcomeHeadingEl || !welcomeSubEl) return;
  const { username } = getCurrentUserIdentity();
  welcomeHeadingEl.textContent = `Welcome, ${username || "there"}!`;
  welcomeSubEl.textContent = hasList
    ? "Select a watchlist or create a new one to continue."
    : "Make a new list to get started!";
}

// ── List selection ────────────────────────────────────
async function selectList(list) {
  activeList = list;
  closeMobileNav();  // close nav drawer on mobile when a list is picked
  renderLists();
  configureListControls();
  if (!list) return;

  try {
    await loadMovies(list.id, moviesEl);
    hideTmdbResults();
  } catch (err) {
    const msg = getErrorMessage(err).toLowerCase();
    if (msg.includes("unauthorized") && !clerk.user) {
      await forceSignedOutState();
      return;
    }
    showStatus(getErrorMessage(err, "Unable to load list"), true);
  }
}

async function loadLists(preferredListId = null) {
  const rows = await apiFetch("/api/lists");
  lists = Array.isArray(rows) ? rows : [];

  // Prefer non-invited lists for auto-selection
  const non_invited = lists.filter(l => l.access_type !== "invited");

  renderLists();

  if (!non_invited.length) {
    activeList = null;
    configureListControls();
    showWelcomeScreen(non_invited.length > 0);
    return;
  }

  const picked =
    (preferredListId && lists.find(l => l.id == preferredListId)) ||
    (activeList && lists.find(l => l.id == activeList.id)) ||
    non_invited[0];

  if (picked?.access_type !== "invited") {
    await selectList(picked);
  } else {
    activeList = null;
    configureListControls();
    showWelcomeScreen(non_invited.length > 0);
  }
}

// ── Auth state ────────────────────────────────────────
async function forceSignedOutState() {
  try { await clerk?.signOut(); } catch { /* ignore */ }
  setGlobalAuthUi(false);
  showStatus("Please sign in.");
}

// ── Main app page init ────────────────────────────────
async function initAppPage() {  // Remove initial loading placeholder as soon as we know auth state
  document.getElementById("app-loading")?.remove();
  if (!clerk.user) {
    setGlobalAuthUi(false);
    return;
  }

  appInitialized = true;
  const { username, email } = getCurrentUserIdentity();
  setGlobalAuthUi(true, username || email);

  // Wire logout
  logoutBtn?.addEventListener("click", async () => {
    await clerk.signOut();
    setGlobalAuthUi(false);
    window.location.href = "./";
  });

  // TMDB autocomplete
  initTmdbSearch(movieTitleInput, tmdbResultsEl, (data) => {
    tmdbSelected = data;
  });

  // Add-movie form
  addMovieForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeList) return;
    const typedTitle = (movieTitleInput?.value || "").trim();
    if (!typedTitle) return;

    const body = (tmdbSelected && tmdbSelected.title === typedTitle)
      ? { ...tmdbSelected }
      : { title: typedTitle };

    try {
      await apiFetch(`/api/lists/${activeList.id}/movies`, {
        method: "POST",
        body,
      });
      if (movieTitleInput) movieTitleInput.value = "";
      tmdbSelected = null;
      hideTmdbResults();
      await loadMovies(activeList.id, moviesEl);
    } catch (err) {
      showStatus(getErrorMessage(err, "Unable to add title"), true);
    }
  });

  // Clear tmdbSelected if user edits the title after picking
  movieTitleInput?.addEventListener("input", () => {
    const q = (movieTitleInput.value || "").trim();
    if (tmdbSelected && tmdbSelected.title !== q) tmdbSelected = null;
  });

  // Load profile + lists
  try {
    await ensureProfile();
    // Check if a specific list was requested via URL param (e.g. coming back from settings)
    const urlListId = new URLSearchParams(window.location.search).get("listId");
    const preferredId = urlListId ? parseInt(urlListId, 10) : null;
    await loadLists(preferredId);
  } catch (err) {
    const msg = getErrorMessage(err).toLowerCase();
    if (msg.includes("unauthorized") || msg.includes("not authenticated")) {
      if (!clerk.user) { await forceSignedOutState(); return; }
      // Post-redirect token timing — retry once after a short delay
      try {
        await new Promise(r => setTimeout(r, 1500));
        await ensureProfile();
        await loadLists(null);
        return;
      } catch (retryErr) {
        console.error("[app] Failed to load app data after retry:", retryErr);
        return;
      }
    }
    console.error("[app] Failed to load app data:", err);
  }
}

// ── Entry point ───────────────────────────────────────
async function main() {
  initSpotlightToggle();
  initMobileNav();

  try {
    clerk = await initializeClerk();
    setClerk(clerk);

    await initAppPage();

    // Handle Clerk post-redirect session settling asynchronously
    clerk.addListener(async ({ user }) => {
      if (user && !appInitialized) {
        await initAppPage();
      } else if (!user && appInitialized) {
        appInitialized = false;
        setGlobalAuthUi(false);
      }
    });
  } catch (err) {
    const message = getErrorMessage(err, "App failed to initialize");
    showAuthError(message);
    console.error("[app] init failed:", err);
  }
}

void main();
