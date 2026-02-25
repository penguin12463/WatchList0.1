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

// App state
let clerk = null;
let lists = [];
let activeList = null;
let appInitialized = false;
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
  return session.getToken();
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

    try {
      const payload = await response.json();
      message = payload?.error || payload?.message || message;
    } catch {
      // no-op
    }

    if (response.status === 401) {
      throw new Error("Unauthorized");
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
    item.className = "nav-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-link";
    if (activeList?.id === list.id) {
      button.classList.add("active");
    }

    button.textContent = list.name;
    button.addEventListener("click", () => {
      selectList(list);
    });

    item.appendChild(button);
    listsEl.appendChild(item);
  }
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

  for (const movie of movies) {
    const card = document.createElement("article");
    card.className = "movie-card";

    const title = document.createElement("h4");
    title.textContent = movie.title;

    const progressWrap = document.createElement("div");
    progressWrap.className = "inline";

    const progress = document.createElement("input");
    progress.type = "range";
    progress.min = "0";
    progress.max = "100";
    progress.value = String(movie.progress_percent || 0);

    const progressValue = document.createElement("span");
    progressValue.className = "hint";
    progressValue.textContent = `${movie.progress_percent || 0}%`;

    progress.addEventListener("input", () => {
      progressValue.textContent = `${progress.value}%`;
    });

    progress.addEventListener("change", async () => {
      try {
        await apiFetch(`/api/movies/${movie.id}`, {
          method: "PATCH",
          body: { progress_percent: Number(progress.value) },
        });
      } catch (error) {
        showStatus(getErrorMessage(error, "Unable to save progress"), true);
      }
    });

    const actions = document.createElement("div");
    actions.className = "inline";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      try {
        await apiFetch(`/api/lists/${activeList.id}/movies/${movie.id}`, { method: "DELETE" });
        await loadMovies(activeList.id);
      } catch (error) {
        showStatus(getErrorMessage(error, "Unable to remove title"), true);
      }
    });

    progressWrap.append(progress, progressValue);
    actions.append(removeBtn);

    card.append(title, progressWrap, actions);
    moviesEl.appendChild(card);
  }
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

async function selectList(list) {
  activeList = list;
  renderLists();
  configureListControls();

  if (!list) return;

  try {
    await Promise.all([loadMovies(list.id), loadSharedUsers(list.id)]);
  } catch (error) {
    if (getErrorMessage(error).toLowerCase().includes("unauthorized")) {
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
    if (getErrorMessage(error).toLowerCase().includes("unauthorized")) {
      await forceSignedOutState();
      return;
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

    const title = (movieTitleInput?.value || "").trim();
    if (!title) return;

    try {
      await apiFetch(`/api/lists/${activeList.id}/movies`, {
        method: "POST",
        body: { title },
      });

      if (movieTitleInput) {
        movieTitleInput.value = "";
      }

      await loadMovies(activeList.id);
      showStatus("Title added.");
    } catch (error) {
      showStatus(getErrorMessage(error, "Unable to add title"), true);
    }
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
