import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js?v=20260222c";

const nativeFetch = globalThis.fetch.bind(globalThis);

function escapeHtml(input) {
  return (input ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}

function isNetworkLikeError(error) {
  const message = String(error?.message ?? error ?? "");
  return (
    error?.name === "TypeError" ||
    message.includes("Failed to fetch") ||
    message.includes("NetworkError") ||
    message.includes("Load failed")
  );
}

function normalizeHeaders(headersLike) {
  if (!headersLike) return {};
  if (headersLike instanceof Headers) return Object.fromEntries(headersLike.entries());
  if (Array.isArray(headersLike)) return Object.fromEntries(headersLike);
  return headersLike;
}

function addNetworkDiagnostics(error, url, method, source) {
  const base = error instanceof Error ? error : new Error(String(error ?? "Unknown error"));
  const lines = [
    `${method} ${url}`,
    `transport: ${source}`,
    `online: ${typeof navigator !== "undefined" ? navigator.onLine : "unknown"}`,
    `origin: ${typeof location !== "undefined" ? location.origin : "unknown"}`
  ];
  base._diagMessage = lines.join("\n");
  return base;
}

function xhrFetch(input, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const url = typeof input === "string" ? input : input.url;
  const headers = normalizeHeaders(init.headers);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = 20000;

    Object.entries(headers).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        xhr.setRequestHeader(key, String(value));
      }
    });

    xhr.onload = () => {
      const responseHeaders = new Headers();
      const rawHeaders = xhr.getAllResponseHeaders() || "";
      rawHeaders.trim().split(/\r?\n/).forEach((line) => {
        const index = line.indexOf(":");
        if (index <= 0) return;
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim();
        if (key) responseHeaders.append(key, value);
      });

      resolve(new Response(xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: responseHeaders
      }));
    };

    xhr.onerror = () => reject(addNetworkDiagnostics(new TypeError("NetworkError when attempting to fetch resource."), url, method, "xhr"));
    xhr.ontimeout = () => reject(addNetworkDiagnostics(new TypeError("Network request timed out."), url, method, "xhr"));
    xhr.send(init.body ?? null);
  });
}

async function fetchWithTransportFallback(input, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const url = typeof input === "string" ? input : input.url;
  try {
    return await nativeFetch(input, init);
  } catch (error) {
    if (!isNetworkLikeError(error)) throw error;
    try {
      return await xhrFetch(input, init);
    } catch (xhrError) {
      throw addNetworkDiagnostics(xhrError, url, method, "fetch->xhr");
    }
  }
}

async function requestJson(url, init) {
  const response = await fetchWithTransportFallback(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.error_description || payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

function withTimeout(promise, ms, label) {
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`${label} timed out. Please try again.`)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timerId);
  });
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    fetch: fetchWithTransportFallback
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});
const page = document.body.dataset.page || "app";

const statusEl = document.getElementById("status");
const setStatus = (msg, isError = false) => {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "#b42323" : "#1d4ed8";
};

function showAuthError(authErrorEl, message, error) {
  if (!authErrorEl) return;
  const diagnostic = error?._diagMessage;
  if (diagnostic) {
    authErrorEl.innerHTML = `${escapeHtml(message)}<details style="margin-top:8px;"><summary>Connection diagnostics</summary><pre style="white-space:pre-wrap; margin:6px 0 0;">${escapeHtml(diagnostic)}</pre></details>`;
  } else {
    authErrorEl.textContent = message;
  }
  authErrorEl.classList.remove("hidden");
}

function toErrorMessage(error, fallback = "Request failed.") {
  const message = error?.message || String(error || "");
  if (!message || message === "TypeError: Failed to fetch" || message.includes("NetworkError")) {
    return "Network error talking to Supabase. Check domain/SSL and try again.";
  }
  return message || fallback;
}

async function restSignIn(email, password) {
  const payload = await requestJson(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  if (!payload?.access_token || !payload?.refresh_token) {
    throw new Error("Sign in response missing session tokens.");
  }

  await supabase.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token
  });
}

async function restSignUp(email, password, username) {
  return await requestJson(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email,
      password,
      data: { username }
    })
  });
}

async function initSignInPage() {
  const authError = document.getElementById("auth-error");
  const form = document.getElementById("signin-form");
  const submitBtn = document.getElementById("signin-submit");
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    authError?.classList.add("hidden");
    authError && (authError.textContent = "");

    const email = document.getElementById("signin-email").value.trim();
    const password = document.getElementById("signin-password").value;

    if (!email || !password) {
      if (authError) {
        authError.textContent = "Email and password are required.";
        authError.classList.remove("hidden");
      }
      setStatus("Please complete all fields.", true);
      return;
    }

    submitBtn && (submitBtn.disabled = true);
    setStatus("Signing in...");

    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        15000,
        "Sign in request"
      );
      if (error) {
        const message = toErrorMessage(error, "Sign in failed.");
        showAuthError(authError, message, error);
        setStatus(message, true);
        try {
          await withTimeout(restSignIn(email, password), 15000, "Fallback sign in request");
          setStatus("Signed in. Redirecting...");
          window.location.href = "./";
          return;
        } catch (fallbackErr) {
          const fallbackMessage = toErrorMessage(fallbackErr, "Sign in failed.");
          showAuthError(authError, fallbackMessage, fallbackErr);
          setStatus(fallbackMessage, true);
          submitBtn && (submitBtn.disabled = false);
          return;
        }
      }

      setStatus("Signed in. Redirecting...");
      window.location.href = "./";
    } catch (err) {
      try {
        await withTimeout(restSignIn(email, password), 15000, "Fallback sign in request");
        setStatus("Signed in. Redirecting...");
        window.location.href = "./";
      } catch (fallbackErr) {
        const message = toErrorMessage(fallbackErr, "Sign in failed.");
        showAuthError(authError, message, fallbackErr);
        setStatus(message, true);
        submitBtn && (submitBtn.disabled = false);
      }
    }
  });
}

async function initSignUpPage() {
  const authError = document.getElementById("auth-error");
  const form = document.getElementById("signup-form");
  const submitBtn = document.getElementById("signup-submit");
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    authError?.classList.add("hidden");
    authError && (authError.textContent = "");

    const email = document.getElementById("signup-email").value.trim();
    const username = document.getElementById("signup-username").value.trim();
    const password = document.getElementById("signup-password").value;
    const confirmPassword = document.getElementById("signup-confirm-password").value;

    if (!username || !email || !password || !confirmPassword) {
      if (authError) {
        authError.textContent = "All fields are required.";
        authError.classList.remove("hidden");
      }
      setStatus("Please complete all fields.", true);
      return;
    }

    if (password.length < 8) {
      if (authError) {
        authError.textContent = "Password must be at least 8 characters.";
        authError.classList.remove("hidden");
      }
      setStatus("Password too short.", true);
      return;
    }

    if (password !== confirmPassword) {
      if (authError) {
        authError.textContent = "Passwords do not match.";
        authError.classList.remove("hidden");
      }
      setStatus("Passwords do not match.", true);
      return;
    }

    submitBtn && (submitBtn.disabled = true);
    setStatus("Creating account...");

    try {
      const { data: signupData, error } = await withTimeout(
        supabase.auth.signUp({
          email,
          password,
          options: { data: { username } }
        }),
        15000,
        "Sign up request"
      );

      if (error) {
        const message = toErrorMessage(error, "Sign up failed.");
        showAuthError(authError, message, error);
        setStatus(message, true);
        submitBtn && (submitBtn.disabled = false);
        return;
      }

      if (signupData.session?.user) {
        setStatus("Sign-up successful. Redirecting...");
        window.location.href = "./";
        return;
      }

      setStatus("Sign-up successful. Check your email to confirm your account, then sign in.");
      submitBtn && (submitBtn.disabled = false);
    } catch (err) {
      try {
        const fallback = await withTimeout(restSignUp(email, password, username), 15000, "Fallback sign up request");
        if (fallback?.access_token && fallback?.refresh_token) {
          await supabase.auth.setSession({
            access_token: fallback.access_token,
            refresh_token: fallback.refresh_token
          });
          setStatus("Sign-up successful. Redirecting...");
          window.location.href = "./";
          return;
        }

        setStatus("Sign-up successful. Check your email to confirm your account, then sign in.");
        submitBtn && (submitBtn.disabled = false);
      } catch (fallbackErr) {
        const message = toErrorMessage(fallbackErr, "Sign up failed.");
        showAuthError(authError, message, fallbackErr);
        setStatus(message, true);
        submitBtn && (submitBtn.disabled = false);
      }
    }
  });
}

async function initAppPage() {
  const authCard = document.getElementById("signed-out-panel");
  const appRoot = document.getElementById("app");
  const whoamiEl = document.getElementById("whoami");
  const logoutBtn = document.getElementById("logout-btn");
  const spotlightToggle = document.getElementById("spotlight-toggle");
  const contentSurface = document.getElementById("content-surface");

  const listsEl = document.getElementById("lists");
  const moviesEl = document.getElementById("movies");
  const sharedUsersEl = document.getElementById("shared-users");
  const currentListTitleEl = document.getElementById("current-list-title");
  const ownerActionsEl = document.getElementById("owner-actions");
  const addMovieForm = document.getElementById("add-movie-form");
  const renameInput = document.getElementById("rename-input");

  let sessionUser = null;
  let selectedList = null;
  let watchlists = [];

  const applySpotlightState = (enabled) => {
    contentSurface?.classList.toggle("spotlight-off", !enabled);
    if (spotlightToggle) spotlightToggle.checked = enabled;
    localStorage.setItem("watchlyst.spotlight", enabled ? "1" : "0");
  };

  const initSpotlight = () => {
    const saved = localStorage.getItem("watchlyst.spotlight");
    applySpotlightState(saved !== "0");

    spotlightToggle?.addEventListener("change", () => {
      applySpotlightState(spotlightToggle.checked);
    });

    window.addEventListener("mousemove", (ev) => {
      if (!contentSurface || contentSurface.classList.contains("spotlight-off")) return;
      const rect = contentSurface.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
        contentSurface.style.setProperty("--mx", `${x}px`);
        contentSurface.style.setProperty("--my", `${y}px`);
      }
    });
  };

  const ensureProfile = async (username) => {
    if (!sessionUser) return;
    const { data: existing } = await supabase.from("profiles").select("id").eq("id", sessionUser.id).maybeSingle();
    if (!existing) {
      await supabase.from("profiles").insert({ id: sessionUser.id, username: username ?? `user_${sessionUser.id.slice(0, 8)}` });
    }
  };

  const renderWatchlists = () => {
    if (!watchlists.length) {
      listsEl.innerHTML = `<div class="list-item"><span class="nav-link-btn" style="opacity:.8;">No lists yet.</span></div>`;
      return;
    }

    listsEl.innerHTML = watchlists.map((w) => {
      const isSelected = selectedList?.id === w.id;
      const role = w.access_type === "owner" ? "OWNER" : w.access_type === "shared" ? "SHARED" : "INVITE";
      const inviteIcon = w.access_type === "invited" ? `<span class="bi bi-clock-fill pending-share-icon"></span>` : "";
      return `
        <div class="list-item">
          <div class="row">
            <button class="nav-link-btn ${isSelected ? "active" : ""}" data-action="select-list" data-id="${w.id}">
              <span class="bi bi-list-nested"></span>
              <span>${escapeHtml(w.name)}</span>
              ${inviteIcon}
            </button>
          </div>
          <div class="row" style="margin-top:4px;">
            <span class="role-badge">${role}</span>
            ${w.access_type === "invited"
              ? `<button data-action="accept-invite" data-id="${w.id}">Accept</button><button class="danger" data-action="decline-invite" data-id="${w.id}">Decline</button>`
              : `<button class="danger" data-action="delete-or-leave" data-id="${w.id}">${w.access_type === "owner" ? "Delete" : "Leave"}</button>`}
          </div>
        </div>
      `;
    }).join("");
  };

  const loadSharedUsers = async () => {
    if (!selectedList || selectedList.access_type !== "owner") {
      sharedUsersEl.innerHTML = "";
      return;
    }

    const { data, error } = await supabase
      .from("watchlist_shares")
      .select("user_id, profiles(username)")
      .eq("watchlist_id", selectedList.id)
      .order("created_at", { ascending: true });

    if (error) {
      sharedUsersEl.innerHTML = "<p>Unable to load shared users.</p>";
      return;
    }

    const rows = data ?? [];
    if (!rows.length) {
      sharedUsersEl.innerHTML = "<p>No shared users yet.</p>";
      return;
    }

    sharedUsersEl.innerHTML = rows.map((x) => {
      const username = x.profiles?.username ?? x.user_id;
      return `<div class="row"><span>${escapeHtml(username)}</span><button class="danger" data-action="remove-shared-user" data-user="${x.user_id}">Remove</button></div>`;
    }).join("");
  };

  const loadMovies = async () => {
    if (!selectedList) return;

    const { data, error } = await supabase
      .from("watchlist_movies")
      .select("movie_id, movies(*)")
      .eq("watchlist_id", selectedList.id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const rows = data ?? [];
    if (!rows.length) {
      moviesEl.innerHTML = "<p>No movies yet.</p>";
      return;
    }

    moviesEl.innerHTML = rows.map(({ movies: m }) => {
      if (!m) return "";
      return `
        <div class="movie-item">
          <div class="row">
            <strong>${escapeHtml(m.title)}</strong>
            <button class="danger" data-action="remove-movie" data-id="${m.id}">Remove</button>
          </div>
          <div class="row" style="margin-top:6px;">
            <input data-edit="watched_runtime" data-id="${m.id}" type="number" placeholder="Watched minutes" value="${m.watched_runtime ?? ""}" />
            <input data-edit="watched_episodes" data-id="${m.id}" type="number" placeholder="Watched episodes" value="${m.watched_episodes ?? ""}" />
            <input data-edit="rating" data-id="${m.id}" type="number" min="1" max="5" placeholder="Rating 1-5" value="${m.rating ?? ""}" />
            <button data-action="save-progress" data-id="${m.id}">Save</button>
          </div>
        </div>
      `;
    }).join("");
  };

  const loadWatchlists = async () => {
    const { data, error } = await supabase
      .from("v_user_watchlists")
      .select("id,name,owner_id,owner_username,access_type,created_at")
      .order("created_at", { ascending: true });

    if (error) throw error;

    watchlists = data ?? [];
    if (selectedList && !watchlists.some((x) => x.id === selectedList.id)) {
      selectedList = null;
    }

    renderWatchlists();

    if (selectedList) {
      selectedList = watchlists.find((x) => x.id === selectedList.id) ?? null;
      await loadMovies();
      await loadSharedUsers();
    } else {
      moviesEl.innerHTML = "";
      sharedUsersEl.innerHTML = "";
      currentListTitleEl.textContent = "Select a list";
      ownerActionsEl.classList.add("hidden");
      addMovieForm.classList.add("hidden");
    }
  };

  const tmdbFetch = async (payload) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/tmdb-proxy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    return res.ok ? res.json() : null;
  };

  const addMovieToSelectedList = async (title) => {
    if (!selectedList) return;

    let mediaType = null;
    let tmdbId = null;
    let runtime = null;
    let numberOfEpisodes = null;

    const search = await tmdbFetch({ action: "search", query: title });
    const best = search?.results?.[0];

    if (best) {
      mediaType = best.media_type ?? null;
      tmdbId = best.id ?? null;

      if (mediaType === "movie") {
        const details = await tmdbFetch({ action: "movie", id: tmdbId });
        runtime = details?.runtime ?? null;
      }

      if (mediaType === "tv") {
        const details = await tmdbFetch({ action: "tv", id: tmdbId });
        numberOfEpisodes = details?.number_of_episodes ?? null;
      }
    }

    const { error } = await supabase.rpc("add_movie_to_watchlist", {
      p_watchlist_id: selectedList.id,
      p_title: title,
      p_media_type: mediaType,
      p_tmdb_id: tmdbId,
      p_runtime: runtime,
      p_number_of_episodes: numberOfEpisodes
    });

    if (error) throw error;
    await loadMovies();
  };

  const bootstrap = async () => {
    let user = null;
    const { data: sess } = await supabase.auth.getSession();
    user = sess?.session?.user ?? null;

    if (!user && typeof navigator !== "undefined" && navigator.onLine) {
      try {
        const { data } = await supabase.auth.getUser();
        user = data.user;
      } catch {
      }
    }

    sessionUser = user;

    if (!sessionUser) {
      authCard.classList.remove("hidden");
      appRoot.classList.add("hidden");
      logoutBtn.classList.add("hidden");
      whoamiEl.textContent = "Not signed in";
      return;
    }

    await ensureProfile(null);
    whoamiEl.textContent = sessionUser.email;
    logoutBtn.classList.remove("hidden");
    authCard.classList.add("hidden");
    appRoot.classList.remove("hidden");
    await loadWatchlists();
  };

  const selectList = async (id) => {
    selectedList = watchlists.find((w) => w.id === id) ?? null;
    if (!selectedList) return;

    currentListTitleEl.textContent = selectedList.name;
    renameInput.value = selectedList.name;
    ownerActionsEl.classList.toggle("hidden", selectedList.access_type !== "owner");
    addMovieForm.classList.remove("hidden");

    await loadMovies();
    await loadSharedUsers();
    renderWatchlists();
  };

  const removeMovie = async (movieId) => {
    const { error } = await supabase
      .from("watchlist_movies")
      .delete()
      .eq("watchlist_id", selectedList.id)
      .eq("movie_id", movieId);
    if (error) throw error;
    await loadMovies();
  };

  const saveMovieProgress = async (movieId) => {
    const watchedRuntime = document.querySelector(`input[data-edit='watched_runtime'][data-id='${movieId}']`)?.value;
    const watchedEpisodes = document.querySelector(`input[data-edit='watched_episodes'][data-id='${movieId}']`)?.value;
    const rating = document.querySelector(`input[data-edit='rating'][data-id='${movieId}']`)?.value;

    const payload = {
      watched_runtime: watchedRuntime ? Number(watchedRuntime) : null,
      watched_episodes: watchedEpisodes ? Number(watchedEpisodes) : null,
      rating: rating ? Number(rating) : null
    };

    const { error } = await supabase.from("movies").update(payload).eq("id", movieId);
    if (error) throw error;
    setStatus("Movie updated.");
  };

  const acceptInvite = async (listId) => {
    const { error } = await supabase.rpc("accept_invitation", { p_watchlist_id: listId });
    if (error) throw error;
    await loadWatchlists();
  };

  const declineInvite = async (listId) => {
    const { error } = await supabase.rpc("decline_invitation", { p_watchlist_id: listId });
    if (error) throw error;
    await loadWatchlists();
  };

  const deleteOrLeave = async (list) => {
    if (list.access_type === "owner") {
      const { error } = await supabase.from("watchlists").delete().eq("id", list.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("watchlist_shares").delete().eq("watchlist_id", list.id).eq("user_id", sessionUser.id);
      if (error) throw error;
    }

    if (selectedList?.id === list.id) selectedList = null;
    await loadWatchlists();
  };

  const removeSharedUser = async (userId) => {
    if (!selectedList) return;
    const { error } = await supabase.from("watchlist_shares").delete().eq("watchlist_id", selectedList.id).eq("user_id", userId);
    if (error) throw error;
    await loadSharedUsers();
  };

  logoutBtn.addEventListener("click", async () => {
    await supabase.auth.signOut();
    selectedList = null;
    await bootstrap();
  });

  document.getElementById("new-list-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = document.getElementById("new-list-name").value.trim();
    if (!name) return;

    const { error } = await supabase.from("watchlists").insert({ name, owner_id: sessionUser.id });
    if (error) return setStatus(error.message, true);

    document.getElementById("new-list-name").value = "";
    await loadWatchlists();
  });

  document.getElementById("rename-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!selectedList) return;
    const newName = renameInput.value.trim();
    if (!newName) return;

    const { error } = await supabase.from("watchlists").update({ name: newName }).eq("id", selectedList.id);
    if (error) return setStatus(error.message, true);

    await loadWatchlists();
    setStatus("List renamed.");
  });

  document.getElementById("invite-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!selectedList) return;

    const username = document.getElementById("invite-username").value.trim();
    if (!username) return;

    const { error } = await supabase.rpc("invite_user_by_username", {
      p_watchlist_id: selectedList.id,
      p_username: username
    });

    if (error) return setStatus(error.message, true);

    document.getElementById("invite-username").value = "";
    setStatus("Invite sent.");
  });

  addMovieForm?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const title = document.getElementById("movie-title-input").value.trim();
    if (!title) return;

    try {
      await addMovieToSelectedList(title);
      document.getElementById("movie-title-input").value = "";
      setStatus("Movie added.");
    } catch (e) {
      setStatus(e.message, true);
    }
  });

  listsEl?.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    const list = watchlists.find((x) => x.id === id);

    try {
      if (action === "select-list") await selectList(id);
      if (action === "accept-invite") await acceptInvite(id);
      if (action === "decline-invite") await declineInvite(id);
      if (action === "delete-or-leave" && list) await deleteOrLeave(list);
    } catch (e) {
      setStatus(e.message, true);
    }
  });

  moviesEl?.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);

    try {
      if (action === "remove-movie") await removeMovie(id);
      if (action === "save-progress") await saveMovieProgress(id);
    } catch (e) {
      setStatus(e.message, true);
    }
  });

  sharedUsersEl?.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn || btn.dataset.action !== "remove-shared-user") return;
    try {
      await removeSharedUser(btn.dataset.user);
    } catch (e) {
      setStatus(e.message, true);
    }
  });

  initSpotlight();
  await bootstrap();
}

(async () => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setStatus("Missing Supabase config values.", true);
      return;
    }

    if (page === "signin") {
      await initSignInPage();
      return;
    }

    if (page === "signup") {
      await initSignUpPage();
      return;
    }

    await initAppPage();
  } catch (err) {
    setStatus(err?.message ?? "Unexpected error", true);
  }
})();
