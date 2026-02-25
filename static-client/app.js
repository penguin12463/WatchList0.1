import { CLERK_PUBLISHABLE_KEY, WORKER_API_BASE_URL } from "./config.js";

// DOM element references
const statusEl = document.getElementById("status");
const authErrorEl = document.getElementById("auth-error");
const contentSurface = document.getElementById("content-surface");
const spotlightToggle = document.getElementById("spotlight-toggle");
const whoamiEl = document.getElementById("whoami");
const logoutBtn = document.getElementById("logout-btn");
const signinTopLink = document.getElementById("signin-top-link");
const signedOutPanel = document.getElementById("signed-out-panel");
const appPanel = document.getElementById("app");
const listsEl = document.getElementById("lists");
const moviesEl = document.getElementById("movies");
const newListForm = document.getElementById("new-list-form");
const newListNameInput = document.getElementById("new-list-name");
const renameForm = document.getElementById("rename-form");
const renameInput = document.getElementById("rename-input");
const inviteForm = document.getElementById("invite-form");
const inviteUsernameInput = document.getElementById("invite-username");
const addMovieForm = document.getElementById("add-movie-form");
const movieTitleInput = document.getElementById("movie-title-input");
const ownerActionsEl = document.getElementById("owner-actions");
const sharedUsersEl = document.getElementById("shared-users");
const currentListTitleEl = document.getElementById("current-list-title");
const tmdbResultsEl = document.getElementById("tmdb-results");

// App state
let clerk = null;
let lists = [];
let activeList = null;
let appInitialized = false;
let tmdbSearchTimer = null;
let tmdbSelected = null;
const page = document.body?.dataset?.page || "app";

async function initializeClerk() {
  if (!window.Clerk) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@latest/dist/clerk.browser.js";
      script.setAttribute("data-clerk-publishable-key", CLERK_PUBLISHABLE_KEY);
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  await window.Clerk.load();
  clerk = window.Clerk;
}

function showStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.style.color = isError ? "#dc3545" : "";
}

function showAuthError(message) {
  if (!authErrorEl) return;
  if (!message) {
    authErrorEl.textContent = "";
    authErrorEl.classList.add("hidden");
    return;
  }

  authErrorEl.textContent = message;
  authErrorEl.classList.remove("hidden");
}

function applySpotlight(enabled) {
  if (!contentSurface) return;
  contentSurface.classList.toggle("spotlight-off", !enabled);
}

function initSpotlightToggle() {
  if (!spotlightToggle) return;

  const saved = localStorage.getItem("watchlyst.spotlight");
  const enabled = saved !== "off";
  spotlightToggle.checked = enabled;
  applySpotlight(enabled);

  spotlightToggle.addEventListener("change", () => {
    const on = spotlightToggle.checked;
    localStorage.setItem("watchlyst.spotlight", on ? "on" : "off");
    applySpotlight(on);
  });
}

function setGlobalAuthUi(isSignedIn, displayName = "") {
  if (whoamiEl) whoamiEl.textContent = isSignedIn && displayName ? `Signed in as ${displayName}` : "";
  if (logoutBtn) logoutBtn.classList.toggle("hidden", !isSignedIn);
  if (signinTopLink) signinTopLink.classList.toggle("hidden", isSignedIn);

  if (signedOutPanel) signedOutPanel.classList.toggle("hidden", isSignedIn);
  if (appPanel) appPanel.classList.toggle("hidden", !isSignedIn);
}

function normalizeApiBase(url) {
  return (url || "").replace(/\/+$/, "");
}

async function getAuthToken() {
  const session = clerk?.session;
  if (!session) return null;
  return session.getToken({ skipCache: true });
}

function getErrorMessage(error, fallback = "Request failed") {
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

async function apiFetch(path, options = {}) {
  const base = normalizeApiBase(WORKER_API_BASE_URL);
  if (!base) {
    throw new Error("Missing WORKER_API_BASE_URL in static-client/config.js");
  }

  const token = await getAuthToken();
  if (!token) {
    throw new Error("Not authenticated");
  }

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
    } catch {
      // no-op
    }

    if (response.status === 401) {
      const fullMsg = detail ? `Unauthorized: ${detail}` : "Unauthorized";
      console.error(`[apiFetch] 401 on ${path} — ${fullMsg}`);
      throw new Error(fullMsg);
    }

    throw new Error(message);
  }

  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getCurrentUserIdentity() {
  const user = clerk?.user;
  if (!user) return { username: "", email: "" };

  const email = user.primaryEmailAddress?.emailAddress || user.emailAddresses?.[0]?.emailAddress || "";
  const username = user.username || user.firstName || (email ? email.split("@")[0] : "");

  return { username, email };
}

async function ensureProfile() {
  const { username, email } = getCurrentUserIdentity();

  await apiFetch("/api/profile/ensure", {
    method: "POST",
    body: { username, email },
  });
}

function renderLists() {
  if (!listsEl) return;
  listsEl.innerHTML = "";

  for (const list of lists) {
    const item = document.createElement("div");
    item.className = "nav-item list-item";
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.gap = "0.3rem";

    if (list.access_type === "invited") {
      // Pending invitation — cannot select, must accept/decline first
      const nameSpan = document.createElement("span");
      nameSpan.className = "nav-link";
      nameSpan.style.fontStyle = "italic";
      nameSpan.style.flex = "1";
      nameSpan.textContent = list.name;

      const badge = document.createElement("span");
      badge.className = "role-badge pending-share-icon";
      badge.title = "Pending invitation";
      badge.innerHTML = '<i class="bi bi-envelope-fill"></i>';

      const acceptBtn = document.createElement("button");
      acceptBtn.type = "button";
      acceptBtn.className = "secondary";
      acceptBtn.style.cssText = "padding:0.15rem 0.45rem;font-size:0.78rem;";
      acceptBtn.textContent = "Accept";
      acceptBtn.addEventListener("click", () => acceptInvitation(list));

      const declineBtn = document.createElement("button");
      declineBtn.type = "button";
      declineBtn.className = "danger";
      declineBtn.style.cssText = "padding:0.15rem 0.45rem;font-size:0.78rem;";
      declineBtn.textContent = "Decline";
      declineBtn.addEventListener("click", () => declineInvitation(list));

      item.append(nameSpan, badge, acceptBtn, declineBtn);
    } else {
      // Owner or shared — clickable
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nav-link";
      button.style.flex = "1";
      button.style.textAlign = "left";
      if (activeList?.id === list.id) button.classList.add("active");
      button.textContent = list.name;
      button.addEventListener("click", () => selectList(list));

      item.appendChild(button);

      if (list.access_type === "shared") {
        const badge = document.createElement("span");
        badge.className = "role-badge";
        badge.textContent = "shared";
        item.appendChild(badge);
      }

      const actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.title = list.access_type === "owner" ? "Delete list" : "Leave list";
      actionBtn.style.cssText = "padding:0.2rem 0.4rem;font-size:0.85rem;flex-shrink:0;";
      actionBtn.innerHTML = list.access_type === "owner"
        ? '<i class="bi bi-trash"></i>'
        : '<i class="bi bi-box-arrow-right"></i>';
      actionBtn.className = list.access_type === "owner" ? "danger" : "secondary";
      actionBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteOrLeaveList(list);
      });

      item.appendChild(actionBtn);
    }

    listsEl.appendChild(item);
  }
}

function buildMovieItem(movie) {
  const wrapper = document.createElement("div");
  wrapper.className = "movie-item";

  // ── View mode ──
  const viewEl = document.createElement("div");
  viewEl.className = "movie-item-view";

  const dot = document.createElement("i");
  dot.className = "bi bi-circle-fill movie-item-dot";

  const titleSpan = document.createElement("span");
  titleSpan.className = "movie-item-title";
  titleSpan.textContent = movie.title;

  const progressEl = document.createElement("span");
  progressEl.className = "movie-item-progress";
  const isTV = movie.media_type === "tv";
  const typeIcon = document.createElement("i");
  typeIcon.className = isTV ? "bi bi-display" : "bi bi-film";
  progressEl.appendChild(typeIcon);

  const makeProgressText = (m) => {
    const tv = m.media_type === "tv";
    if (tv) {
      const w = m.watched_episodes ?? 0;
      const t = m.number_of_episodes;
      return t ? ` ${w} / ${t} ep` : (w ? ` ${w} ep` : "");
    } else {
      const w = m.watched_runtime ?? 0;
      const t = m.runtime;
      return t ? ` ${w} / ${t} min` : (w ? ` ${w} min` : "");
    }
  };

  const progressText = makeProgressText(movie);
  if (progressText) progressEl.appendChild(document.createTextNode(progressText));

  const starsEl = document.createElement("span");
  starsEl.className = "movie-item-stars";
  const rating = movie.rating || 0;
  starsEl.textContent = "\u2605".repeat(rating) + "\u2606".repeat(5 - rating);

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "movie-item-edit-btn";
  editBtn.title = "Edit";
  editBtn.innerHTML = '<i class="bi bi-pen-fill"></i>';

  viewEl.append(dot, titleSpan, progressEl, starsEl, editBtn);

  // ── Edit mode ──
  const editEl = document.createElement("div");
  editEl.className = "movie-item-edit-form hidden";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "title-input";
  titleInput.value = movie.title;
  titleInput.maxLength = 120;

  const typeSelect = document.createElement("select");
  typeSelect.innerHTML = `<option value="movie"${!isTV ? " selected" : ""}>Movie</option><option value="tv"${isTV ? " selected" : ""}>TV</option>`;

  const watchedLabel = document.createElement("span");
  watchedLabel.style.cssText = "font-size:0.85rem;color:#555;";

  const watchedInput = document.createElement("input");
  watchedInput.type = "number";
  watchedInput.className = "num-input";
  watchedInput.min = "0";

  const totalSep = document.createElement("span");
  totalSep.textContent = "/";
  totalSep.style.cssText = "font-size:0.85rem;color:#555;";

  const totalInput = document.createElement("input");
  totalInput.type = "number";
  totalInput.className = "num-input";
  totalInput.min = "0";

  const syncEditFields = (currentMovie) => {
    const nowTV = typeSelect.value === "tv";
    watchedLabel.textContent = nowTV ? "Ep watched" : "Min watched";
    watchedInput.value = nowTV
      ? String(currentMovie.watched_episodes ?? "")
      : String(currentMovie.watched_runtime ?? "");
    totalInput.value = nowTV
      ? String(currentMovie.number_of_episodes ?? "")
      : String(currentMovie.runtime ?? "");
    totalInput.placeholder = nowTV ? "Total ep" : "Total min";
  };

  syncEditFields(movie);
  typeSelect.addEventListener("change", () => syncEditFields(movie));

  const ratingSelect = document.createElement("select");
  ratingSelect.innerHTML = `<option value="">No rating</option>` +
    [1, 2, 3, 4, 5].map((n) => `<option value="${n}"${movie.rating === n ? " selected" : ""}>${"\u2605".repeat(n)}</option>`).join("");

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "action-btn";
  saveBtn.title = "Save";
  saveBtn.innerHTML = '<i class="bi bi-check-lg"></i>';

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "action-btn secondary";
  cancelBtn.title = "Cancel";
  cancelBtn.innerHTML = '<i class="bi bi-x-lg"></i>';

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "action-btn delete-btn";
  deleteBtn.title = "Remove from list";
  deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';

  editEl.append(titleInput, typeSelect, watchedLabel, watchedInput, totalSep, totalInput, ratingSelect, saveBtn, cancelBtn, deleteBtn);

  // Toggle edit mode
  editBtn.addEventListener("click", () => {
    viewEl.classList.add("hidden");
    editEl.classList.remove("hidden");
    syncEditFields(movie);
  });

  cancelBtn.addEventListener("click", () => {
    editEl.classList.add("hidden");
    viewEl.classList.remove("hidden");
  });

  saveBtn.addEventListener("click", async () => {
    const nowTV = typeSelect.value === "tv";
    const patch = {
      title: titleInput.value.trim() || movie.title,
      media_type: typeSelect.value,
      watched_runtime: nowTV ? null : (Number(watchedInput.value) || null),
      runtime: nowTV ? null : (Number(totalInput.value) || null),
      watched_episodes: nowTV ? (Number(watchedInput.value) || null) : null,
      number_of_episodes: nowTV ? (Number(totalInput.value) || null) : null,
      rating: ratingSelect.value ? Number(ratingSelect.value) : null,
    };
    try {
      const updated = await apiFetch(`/api/movies/${movie.id}`, { method: "PATCH", body: patch });
      Object.assign(movie, updated);
      const newItem = buildMovieItem(movie);
      wrapper.replaceWith(newItem);
    } catch (err) {
      showStatus(getErrorMessage(err, "Unable to save"), true);
    }
  });

  deleteBtn.addEventListener("click", async () => {
    if (!activeList) return;
    if (!confirm(`Remove "${movie.title}" from this list?`)) return;
    try {
      await apiFetch(`/api/lists/${activeList.id}/movies/${movie.id}`, { method: "DELETE" });
      wrapper.remove();
      const listContainer = moviesEl?.querySelector(".movie-list");
      if (listContainer && !listContainer.querySelector(".movie-item")) {
        listContainer.remove();
        const empty = document.createElement("p");
        empty.className = "hint";
        empty.textContent = "No titles yet in this list.";
        moviesEl.appendChild(empty);
      }
    } catch (err) {
      showStatus(getErrorMessage(err, "Unable to remove"), true);
    }
  });

  wrapper.append(viewEl, editEl);
  return wrapper;
}

function renderMovies(movies = []) {
  if (!moviesEl) return;
  moviesEl.innerHTML = "";

  if (!movies.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No titles yet in this list.";
    moviesEl.appendChild(empty);
    return;
  }

  const listContainer = document.createElement("div");
  listContainer.className = "movie-list";
  for (const movie of movies) {
    listContainer.appendChild(buildMovieItem(movie));
  }
  moviesEl.appendChild(listContainer);
}

async function loadMovies(listId) {
  const rows = await apiFetch(`/api/lists/${listId}/movies`);
  renderMovies(Array.isArray(rows) ? rows : []);
}

async function loadSharedUsers(listId) {
  if (!sharedUsersEl) return;

  sharedUsersEl.innerHTML = "";

  if (!activeList?.is_owner) return;

  const users = await apiFetch(`/api/lists/${listId}/shared-users`);
  if (!Array.isArray(users) || !users.length) {
    sharedUsersEl.innerHTML = '<p class="hint">No shared users yet.</p>';
    return;
  }

  for (const user of users) {
    const row = document.createElement("div");
    row.className = "inline";

    const label = document.createElement("span");
    label.textContent = user.username || user.user_id;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      try {
        await apiFetch(`/api/lists/${listId}/shared-users/${encodeURIComponent(user.user_id)}`, {
          method: "DELETE",
        });
        await loadSharedUsers(listId);
      } catch (error) {
        showStatus(getErrorMessage(error, "Unable to remove user"), true);
      }
    });

    row.append(label, removeBtn);
    sharedUsersEl.appendChild(row);
  }
}

function configureListControls() {
  const hasList = !!activeList;

  if (currentListTitleEl) {
    currentListTitleEl.textContent = activeList ? activeList.name : "Select a list";
  }

  if (addMovieForm) {
    addMovieForm.classList.toggle("hidden", !hasList);
  }

  if (ownerActionsEl) {
    ownerActionsEl.classList.toggle("hidden", !hasList || !activeList?.is_owner);
  }

  if (renameInput) {
    renameInput.value = activeList?.name || "";
  }

  if (!hasList && moviesEl) {
    moviesEl.innerHTML = "";
  }

  if (!hasList && sharedUsersEl) {
    sharedUsersEl.innerHTML = "";
  }
}

async function deleteOrLeaveList(list) {
  const isOwner = list.access_type === "owner";
  const verb = isOwner ? "Delete" : "Leave";
  if (!confirm(`${verb} "${list.name}"?`)) return;
  try {
    await apiFetch(`/api/lists/${list.id}`, { method: "DELETE" });
    if (activeList?.id === list.id) activeList = null;
    await loadLists();
    showStatus(`List ${isOwner ? "deleted" : "left"}.`);
  } catch (err) {
    showStatus(getErrorMessage(err, `Unable to ${verb.toLowerCase()} list`), true);
  }
}

async function acceptInvitation(list) {
  try {
    await apiFetch(`/api/lists/${list.id}/accept`, { method: "POST" });
    await loadLists(list.id);
    showStatus("Joined list.");
  } catch (err) {
    showStatus(getErrorMessage(err, "Unable to accept invitation"), true);
  }
}

async function declineInvitation(list) {
  if (!confirm(`Decline invitation to "${list.name}"?`)) return;
  try {
    await apiFetch(`/api/lists/${list.id}/decline`, { method: "POST" });
    await loadLists();
    showStatus("Invitation declined.");
  } catch (err) {
    showStatus(getErrorMessage(err, "Unable to decline invitation"), true);
  }
}

async function selectList(list) {
  activeList = list;
  renderLists();
  configureListControls();

  if (!list) return;

  try {
    await Promise.all([loadMovies(list.id), loadSharedUsers(list.id)]);
  } catch (error) {
    if (getErrorMessage(error).toLowerCase().includes("unauthorized") && !clerk.user) {
      await forceSignedOutState();
      return;
    }

    showStatus(getErrorMessage(error, "Unable to load list details"), true);
  }
}

async function loadLists(preferredListId = null) {
  const rows = await apiFetch("/api/lists");
  lists = Array.isArray(rows) ? rows : [];

  renderLists();

  if (!lists.length) {
    activeList = null;
    configureListControls();
    return;
  }

  const picked =
    (preferredListId && lists.find((list) => list.id === preferredListId)) ||
    (activeList && lists.find((list) => list.id === activeList.id)) ||
    lists[0];

  await selectList(picked);
}

async function forceSignedOutState() {
  try {
    await clerk?.signOut();
  } catch {
    // ignore
  }

  setGlobalAuthUi(false);
  showStatus("Please sign in.");
}

async function initSigninPage() {
  const signinForm = document.getElementById("signin-form");
  const forgotButton = document.getElementById("forgot-password-btn");
  const resetForm = document.getElementById("reset-form");

  if (clerk.user) {
    window.location.href = "./";
    return;
  }

  signinForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAuthError("");

    const email = document.getElementById("signin-email")?.value?.trim();
    const password = document.getElementById("signin-password")?.value;

    if (!email || !password) {
      showAuthError("Enter your email and password.");
      return;
    }

    try {
      let signIn;

      try {
        signIn = await clerk.client.signIn.create({
          strategy: "password",
          identifier: email,
          password,
        });
      } catch (primaryError) {
        const first = primaryError?.errors?.[0];
        const shouldFallback =
          first?.code === "form_param_unknown" ||
          first?.code === "form_param_value_invalid" ||
          first?.code === "strategy_for_user_invalid";

        if (!shouldFallback) throw primaryError;

        signIn = await clerk.client.signIn.create({
          identifier: email,
          password,
        });
      }

      if (signIn.status !== "complete" || !signIn.createdSessionId) {
        throw new Error("Sign-in not completed.");
      }

      await clerk.setActive({ session: signIn.createdSessionId });
      window.location.href = "./";
    } catch (error) {
      showAuthError(getErrorMessage(error, "Unable to sign in"));
    }
  });

  forgotButton?.addEventListener("click", async () => {
    const email = document.getElementById("signin-email")?.value?.trim();
    if (!email) {
      showAuthError("Enter your email first.");
      return;
    }

    try {
      resetSignIn = await clerk.client.signIn.create({
        strategy: "reset_password_email_code",
        identifier: email,
      });

      resetForm?.classList.remove("hidden");
      showStatus("A reset code was sent to your email.");
      showAuthError("");
    } catch (error) {
      showAuthError(getErrorMessage(error, "Could not start reset flow"));
    }
  });

  resetForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const newPassword = document.getElementById("reset-password")?.value;
    const confirmPassword = document.getElementById("reset-confirm-password")?.value;

    if (newPassword !== confirmPassword) {
      showAuthError("Passwords do not match.");
      return;
    }

    if (!resetSignIn) {
      showAuthError("Use 'Forgot password?' first.");
      return;
    }

    const code = window.prompt("Enter the reset code from your email:");
    if (!code) return;

    try {
      const result = await resetSignIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code,
        password: newPassword,
      });

      if (result.status !== "complete" || !result.createdSessionId) {
        throw new Error("Password reset not completed.");
      }

      await clerk.setActive({ session: result.createdSessionId });
      window.location.href = "./";
    } catch (error) {
      showAuthError(getErrorMessage(error, "Could not reset password"));
    }
  });
}

async function initSignupPage() {
  const signupForm = document.getElementById("signup-form");

  if (clerk.user) {
    window.location.href = "./";
    return;
  }

  signupForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAuthError("");

    const username = document.getElementById("signup-username")?.value?.trim();
    const email = document.getElementById("signup-email")?.value?.trim();
    const password = document.getElementById("signup-password")?.value;
    const confirmPassword = document.getElementById("signup-confirm-password")?.value;

    if (password !== confirmPassword) {
      showAuthError("Passwords do not match.");
      return;
    }

    try {
      const signUp = await clerk.client.signUp.create({
        username,
        emailAddress: email,
        password,
      });

      if (signUp.status !== "complete" || !signUp.createdSessionId) {
        showStatus("Account created. Complete any required verification, then sign in.");
        window.location.href = "./signin.html";
        return;
      }

      await clerk.setActive({ session: signUp.createdSessionId });
      window.location.href = "./";
    } catch (error) {
      showAuthError(getErrorMessage(error, "Unable to sign up"));
    }
  });
}

// ── TMDB search helpers ──

function hideTmdbResults() {
  if (!tmdbResultsEl) return;
  tmdbResultsEl.innerHTML = "";
  tmdbResultsEl.classList.add("hidden");
}

function showTmdbResults(results) {
  if (!tmdbResultsEl) return;
  tmdbResultsEl.innerHTML = "";
  if (!results.length) {
    tmdbResultsEl.classList.add("hidden");
    return;
  }
  for (const r of results) {
    const item = document.createElement("div");
    item.className = "tmdb-result-item";

    const icon = document.createElement("i");
    icon.className = r.media_type === "tv" ? "bi bi-display" : "bi bi-film";

    const titleSpan = document.createElement("span");
    titleSpan.style.flex = "1";
    titleSpan.textContent = r.title;

    const yearSpan = document.createElement("span");
    yearSpan.className = "tmdb-year";
    yearSpan.textContent = r.year || "";

    item.append(icon, titleSpan, yearSpan);

    item.addEventListener("mousedown", async (e) => {
      // Prevent losing focus on the input before we finish
      e.preventDefault();
      try {
        const detail = r.media_type === "tv"
          ? await apiFetch(`/api/tmdb/tv/${r.id}`)
          : await apiFetch(`/api/tmdb/movie/${r.id}`);
        tmdbSelected = {
          title: r.title,
          media_type: r.media_type,
          tmdb_id: r.id,
          runtime: r.media_type === "movie" ? (detail?.runtime ?? null) : null,
          number_of_episodes: r.media_type === "tv" ? (detail?.number_of_episodes ?? null) : null,
        };
      } catch {
        tmdbSelected = { title: r.title, media_type: r.media_type, tmdb_id: r.id };
      }
      if (movieTitleInput) movieTitleInput.value = r.title;
      hideTmdbResults();
    });

    tmdbResultsEl.appendChild(item);
  }
  tmdbResultsEl.classList.remove("hidden");
}

async function tmdbSearch(query) {
  if (!query || query.length < 2) {
    hideTmdbResults();
    return;
  }
  try {
    const data = await apiFetch(`/api/tmdb/search?q=${encodeURIComponent(query)}`);
    showTmdbResults(data?.results || []);
  } catch {
    hideTmdbResults();
  }
}

async function initAppPage() {
  if (!clerk.user) {
    setGlobalAuthUi(false);
    return;
  }

  appInitialized = true;
  const identity = getCurrentUserIdentity();
  setGlobalAuthUi(true, identity.username || identity.email);

  try {
    await ensureProfile();
    await loadLists();
  } catch (error) {
    const msg = getErrorMessage(error).toLowerCase();
    if (msg.includes("unauthorized") || msg.includes("not authenticated")) {
      if (!clerk.user) {
        await forceSignedOutState();
        return;
      }
      // Token may not be ready immediately after redirect — retry once
      try {
        await new Promise((r) => setTimeout(r, 1500));
        await ensureProfile();
        await loadLists();
        return;
      } catch (retryError) {
        showStatus(getErrorMessage(retryError, "Failed to load app data"), true);
        return;
      }
    }
    showStatus(getErrorMessage(error, "Failed to load app data"), true);
  }

  newListForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = (newListNameInput?.value || "").trim() || "New List";

    try {
      const created = await apiFetch("/api/lists", {
        method: "POST",
        body: { name },
      });

      if (newListNameInput) {
        newListNameInput.value = "";
      }

      await loadLists(created?.id || null);
      showStatus("List created.");
    } catch (error) {
      showStatus(getErrorMessage(error, "Unable to create list"), true);
    }
  });

  renameForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!activeList) return;

    const newName = (renameInput?.value || "").trim();
    if (!newName) return;

    try {
      await apiFetch(`/api/lists/${activeList.id}`, {
        method: "PATCH",
        body: { name: newName },
      });

      await loadLists(activeList.id);
      showStatus("List renamed.");
    } catch (error) {
      showStatus(getErrorMessage(error, "Unable to rename list"), true);
    }
  });

  inviteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!activeList) return;

    const username = (inviteUsernameInput?.value || "").trim();
    if (!username) return;

    try {
      await apiFetch(`/api/lists/${activeList.id}/invite`, {
        method: "POST",
        body: { username },
      });

      if (inviteUsernameInput) {
        inviteUsernameInput.value = "";
      }

      await loadSharedUsers(activeList.id);
      showStatus("User invited.");
    } catch (error) {
      showStatus(getErrorMessage(error, "Unable to invite user"), true);
    }
  });

  addMovieForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!activeList) return;

    const typedTitle = (movieTitleInput?.value || "").trim();
    if (!typedTitle) return;

    // Use TMDB-selected data if the title still matches what the user picked
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

      await loadMovies(activeList.id);
      showStatus("Title added.");
    } catch (error) {
      showStatus(getErrorMessage(error, "Unable to add title"), true);
    }
  });

  movieTitleInput?.addEventListener("input", () => {
    const q = (movieTitleInput.value || "").trim();
    // clear prior selection if the user changed the text
    if (tmdbSelected && tmdbSelected.title !== q) tmdbSelected = null;
    clearTimeout(tmdbSearchTimer);
    tmdbSearchTimer = setTimeout(() => tmdbSearch(q), 400);
  });

  movieTitleInput?.addEventListener("blur", () => {
    setTimeout(hideTmdbResults, 200);
  });

  logoutBtn?.addEventListener("click", async () => {
    await clerk.signOut();
    setGlobalAuthUi(false);
    window.location.href = "./signin.html";
  });
}

async function main() {
  initSpotlightToggle();

  try {
    await initializeClerk();

    if (page === "signin") {
      await initSigninPage();
      return;
    }

    if (page === "signup") {
      await initSignupPage();
      return;
    }

    await initAppPage();

    // Clerk may process the redirect handshake token asynchronously after
    // load() returns. addListener fires when the session settles, so we
    // catch the case where clerk.user was null on the first check.
    clerk.addListener(async ({ user }) => {
      if (user && !appInitialized) {
        await initAppPage();
      } else if (!user && appInitialized) {
        appInitialized = false;
        setGlobalAuthUi(false);
      }
    });
  } catch (error) {
    const message = getErrorMessage(error, "App failed to initialize");
    showAuthError(message);
    showStatus(message, true);
  }
}

void main();
