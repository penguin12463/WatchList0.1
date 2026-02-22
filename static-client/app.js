import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const page = document.body.dataset.page || "app";

const statusEl = document.getElementById("status");
const setStatus = (msg, isError = false) => {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "#b42323" : "#1d4ed8";
};

function escapeHtml(input) {
  return (input ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}

async function initSignInPage() {
  const authError = document.getElementById("auth-error");
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    window.location.href = "./";
    return;
  }

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

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (authError) {
        authError.textContent = error.message;
        authError.classList.remove("hidden");
      }
      setStatus(error.message, true);
      submitBtn && (submitBtn.disabled = false);
      return;
    }

    setStatus("Signed in. Redirecting...");
    window.location.href = "./";
  });
}

async function initSignUpPage() {
  const authError = document.getElementById("auth-error");
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    window.location.href = "./";
    return;
  }

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

    const { data: signupData, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } }
    });

    if (error) {
      if (authError) {
        authError.textContent = error.message;
        authError.classList.remove("hidden");
      }
      setStatus(error.message, true);
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
    const { data } = await supabase.auth.getUser();
    sessionUser = data.user;

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
