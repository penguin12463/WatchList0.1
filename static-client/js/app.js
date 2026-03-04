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
const backBtnEl         = document.getElementById("back-btn");
const welcomeScreenEl   = document.getElementById("welcome-screen");
const welcomeHeadingEl  = document.getElementById("welcome-heading");
const welcomeSubEl      = document.getElementById("welcome-sub");
const listContentEl     = document.getElementById("list-content");
const addMovieForm      = document.getElementById("add-movie-form");
const movieTitleInput   = document.getElementById("movie-title-input");
const addTypeSelectEl   = document.getElementById("add-type-select");
const tmdbResultsEl     = document.getElementById("tmdb-results");

// ── State ─────────────────────────────────────────────
let clerk           = null;
let lists           = [];
let activeList      = null;
let activeParentList = null;
let activeSubLists   = [];
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
      btn.className = "nav-link" + (activeParentList?.id === list.id ? " active" : "");

      const icon = document.createElement("span");
      icon.className = "bi bi-list-nested";
      icon.style.verticalAlign = "middle";

      const handle = document.createElement("span");
      handle.className = "bi bi-grip-vertical drag-handle";
      handle.title = "Drag to reorder";

      btn.append(icon, ` ${list.name}`, handle);
      btn.addEventListener("click", () => selectList(list));
      item.draggable = true;
      item.dataset.listId = String(list.id);
      item.appendChild(btn);
    }

    listsEl.appendChild(item);

    // Show sub-lists (collections) below the active parent list item
    if (activeParentList?.id === list.id && activeSubLists.length) {
      for (const sub of activeSubLists) {
        const subItem = document.createElement("div");
        subItem.className = "nav-sub-item";
        const subBtn = document.createElement("button");
        subBtn.type = "button";
        subBtn.className = "nav-link" + (activeList?.id === sub.id ? " active" : "");
        const subIcon = document.createElement("span");
        subIcon.className = "bi bi-arrow-return-right";
        subIcon.style.verticalAlign = "middle";
        subBtn.append(subIcon, ` ${sub.name}`);
        subBtn.addEventListener("click", () => selectCollection(sub.id));
        subItem.appendChild(subBtn);
        listsEl.appendChild(subItem);
      }
    }
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
  initListDragAndDrop(listsEl);
}

// ── List nav drag-and-drop reordering ─────────────────
async function saveListOrder(container) {
  const ids = [...container.querySelectorAll(".nav-item[data-list-id]")]
    .map(el => Number(el.dataset.listId));
  // Reorder the local lists array so subsequent renderLists() calls respect the new order.
  const reordered = ids.map(id => lists.find(l => l.id === id)).filter(Boolean);
  const others = lists.filter(l => !ids.includes(l.id));
  lists = [...reordered, ...others];
  try {
    await apiFetch("/api/lists/reorder", { method: "PATCH", body: { ids } });
  } catch (err) {
    showStatus(getErrorMessage(err, "Unable to save list order"), true);
  }
}

function initListDragAndDrop(container) {
  let dragSrc = null;

  // ── Mouse drag-and-drop ──
  container.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".nav-item[data-list-id]");
    if (!item) return;
    dragSrc = item;
    item.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    const target = e.target.closest(".nav-item[data-list-id]");
    if (!target || target === dragSrc) return;
    container.querySelectorAll(".nav-item").forEach(el =>
      el.classList.remove("drag-over-top", "drag-over-bottom")
    );
    const mid = target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
    target.classList.add(e.clientY < mid ? "drag-over-top" : "drag-over-bottom");
  });

  container.addEventListener("dragleave", (e) => {
    if (!container.contains(e.relatedTarget)) {
      container.querySelectorAll(".nav-item").forEach(el =>
        el.classList.remove("drag-over-top", "drag-over-bottom")
      );
    }
  });

  container.addEventListener("drop", async (e) => {
    e.preventDefault();
    const target = e.target.closest(".nav-item[data-list-id]");
    container.querySelectorAll(".nav-item").forEach(el =>
      el.classList.remove("drag-over-top", "drag-over-bottom", "dragging")
    );
    if (!target || !dragSrc || target === dragSrc) { dragSrc = null; return; }
    const mid = target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
    if (e.clientY < mid) container.insertBefore(dragSrc, target);
    else target.after(dragSrc);
    dragSrc = null;
    await saveListOrder(container);
  });

  container.addEventListener("dragend", () => {
    container.querySelectorAll(".nav-item").forEach(el =>
      el.classList.remove("dragging", "drag-over-top", "drag-over-bottom")
    );
    dragSrc = null;
  });

  // ── Touch drag-and-drop (hold drag handle to initiate) ──
  container.addEventListener("touchstart", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle) return;
    const item = handle.closest(".nav-item[data-list-id]");
    if (!item) return;
    dragSrc = item;
    item.classList.add("dragging");
    e.preventDefault();
  }, { passive: false });

  container.addEventListener("touchmove", (e) => {
    if (!dragSrc) return;
    e.preventDefault();
    const touch = e.touches[0];
    dragSrc.style.visibility = "hidden";
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    dragSrc.style.visibility = "";
    const target = el?.closest(".nav-item[data-list-id]");
    container.querySelectorAll(".nav-item").forEach(i =>
      i.classList.remove("drag-over-top", "drag-over-bottom")
    );
    if (target && target !== dragSrc) {
      const mid = target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
      target.classList.add(touch.clientY < mid ? "drag-over-top" : "drag-over-bottom");
    }
  }, { passive: false });

  container.addEventListener("touchend", async (e) => {
    if (!dragSrc) return;
    const touch = e.changedTouches[0];
    dragSrc.style.visibility = "hidden";
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    dragSrc.style.visibility = "";
    const target = el?.closest(".nav-item[data-list-id]");
    container.querySelectorAll(".nav-item").forEach(i =>
      i.classList.remove("drag-over-top", "drag-over-bottom", "dragging")
    );
    if (target && target !== dragSrc) {
      const rect = target.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (touch.clientY < mid) container.insertBefore(dragSrc, target);
      else target.after(dragSrc);
      await saveListOrder(container);
    }
    dragSrc = null;
  });
}
function configureListControls() {
  if (currentTitleEl) {
    currentTitleEl.textContent = activeList?.name ?? "";
  }

  const isSubList = !!(activeList && activeParentList && activeList.id !== activeParentList.id);
  window.isSubListView = () => isSubList;

  if (settingsLinkEl) {
    if (isSubList) {
      settingsLinkEl.style.display = "none";
    } else {
      settingsLinkEl.style.display = "";
      const settingsListId = activeParentList?.id ?? activeList?.id;
      settingsLinkEl.href = settingsListId
        ? `./settings.html?listId=${settingsListId}`
        : "./settings.html";
    }
  }

  if (backBtnEl) {
    backBtnEl.style.display = isSubList ? "" : "none";
    backBtnEl.onclick = () => { if (activeParentList) selectList(activeParentList); };
  }

  // Remove "Collection" option from add-type-select when inside a collection sub-list
  if (addTypeSelectEl) {
    const existing = addTypeSelectEl.querySelector('option[value="collection"]');
    if (isSubList) {
      if (existing) existing.remove();
      if (addTypeSelectEl.value === "collection") addTypeSelectEl.value = "";
    } else {
      if (!existing) {
        const opt = document.createElement("option");
        opt.value = "collection";
        opt.textContent = "Collection";
        addTypeSelectEl.appendChild(opt);
      }
    }
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
  activeParentList = list;
  activeSubLists = [];
  closeMobileNav();  // close nav drawer on mobile when a list is picked
  renderLists();
  configureListControls();
  if (!list) return;

  try {
    await loadMovies(list.id, moviesEl);
    hideTmdbResults();
    // Fetch sub-lists (collections) for this list
    await refreshSubLists();
  } catch (err) {
    const msg = getErrorMessage(err).toLowerCase();
    if (msg.includes("unauthorized") && !clerk.user) {
      await forceSignedOutState();
      return;
    }
    showStatus(getErrorMessage(err, "Unable to load list"), true);
  }
}

async function refreshSubLists() {
  if (!activeParentList) return;
  try {
    const subs = await apiFetch(`/api/lists/${activeParentList.id}/sub-lists`);
    activeSubLists = Array.isArray(subs) ? subs : [];
  } catch { activeSubLists = []; }
  renderLists();
}
window.refreshSubLists = refreshSubLists;

async function selectCollection(collectionListId) {
  let subList = activeSubLists.find(s => s.id === collectionListId);
  if (!subList) {
    // Sub-list not yet loaded — refresh and try again
    await refreshSubLists();
    subList = activeSubLists.find(s => s.id === collectionListId);
  }
  if (!subList) return;
  activeList = subList;
  // activeParentList remains unchanged (the top-level list)
  closeMobileNav();
  renderLists();
  configureListControls();
  try {
    await loadMovies(subList.id, moviesEl);
    hideTmdbResults();
  } catch (err) {
    showStatus(getErrorMessage(err, "Unable to load collection"), true);
  }
}
window.selectCollection = selectCollection;

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

  // TMDB autocomplete — pass type filter getter so results are filtered by selected type
  initTmdbSearch(movieTitleInput, tmdbResultsEl, (data) => {
    tmdbSelected = data;
  }, () => addTypeSelectEl?.value || "");

  // Add-movie form
  addMovieForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeList) return;
    const typedTitle = (movieTitleInput?.value || "").trim();
    if (!typedTitle) return;
    const selectedType = addTypeSelectEl?.value || "";

    // Collections are user-named — skip TMDB data entirely
    let body;
    if (selectedType === "collection") {
      body = { title: typedTitle, media_type: "collection" };
    } else if (tmdbSelected && tmdbSelected.title === typedTitle) {
      body = { ...tmdbSelected };
      // Override type if user explicitly selected one
      if (selectedType) body.media_type = selectedType;
    } else {
      body = { title: typedTitle };
      if (selectedType) body.media_type = selectedType;
    }

    try {
      const result = await apiFetch(`/api/lists/${activeList.id}/movies`, {
        method: "POST",
        body,
      });
      if (movieTitleInput) movieTitleInput.value = "";
      tmdbSelected = null;
      hideTmdbResults();

      // If collection type: immediately PATCH the new item to auto-create its sub-watchlist
      if (selectedType === "collection" && result?.movie_id) {
        try {
          await apiFetch(`/api/movies/${result.movie_id}`, {
            method: "PATCH",
            body: { list_id: activeList.id, media_type: "collection", title: typedTitle },
          });
        } catch { /* sub-list creation is best-effort */ }
      }

      await loadMovies(activeList.id, moviesEl);
      if (selectedType === "collection") window.refreshSubLists?.();
    } catch (err) {
      showStatus(getErrorMessage(err, "Unable to add title"), true);
    }
  });

  // Clear tmdbSelected if user edits the title after picking
  movieTitleInput?.addEventListener("input", () => {
    const q = (movieTitleInput.value || "").trim();
    if (tmdbSelected && tmdbSelected.title !== q) tmdbSelected = null;
  });

  // Update placeholder and hide results when type changes
  addTypeSelectEl?.addEventListener("change", () => {
    const t = addTypeSelectEl.value;
    if (movieTitleInput) {
      movieTitleInput.placeholder =
        t === "collection" ? "Collection name..." :
        t === "movie"      ? "Search movies..." :
        t === "tv"         ? "Search TV shows..." :
                             "Add a title...";
    }
    if (t === "collection") hideTmdbResults();
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
