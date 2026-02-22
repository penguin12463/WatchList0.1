import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const authCard = document.getElementById("auth-card");
const appRoot = document.getElementById("app");
const statusEl = document.getElementById("status");
const whoamiEl = document.getElementById("whoami");

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

const setStatus = (msg, isError = false) => {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "#ff9f9f" : "#9ec1ff";
};

function escapeHtml(input) {
  return (input ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}

async function ensureProfile(username) {
  const { data: existing } = await supabase.from("profiles").select("id").eq("id", sessionUser.id).maybeSingle();
  if (!existing) {
    await supabase.from("profiles").insert({ id: sessionUser.id, username: username ?? `user_${sessionUser.id.slice(0, 8)}` });
  }
}

async function loadWatchlists() {
  const { data, error } = await supabase.from("v_user_watchlists").select("id,name,owner_id,owner_username,access_type,created_at").order("created_at", { ascending: true });
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
}

function renderWatchlists() {
  if (!watchlists.length) {
    listsEl.innerHTML = "<p>No lists yet.</p>";
    return;
  }

  listsEl.innerHTML = watchlists.map((w) => {
    const isSelected = selectedList?.id === w.id;
    const role = w.access_type === "owner" ? "Owner" : w.access_type === "shared" ? "Shared" : "Invite";
    return `
      <div class="list-item">
        <div class="row">
          <button class="secondary" data-action="select-list" data-id="${w.id}">${escapeHtml(w.name)}</button>
          <span>${role}</span>
        </div>
        <div class="row" style="margin-top:6px;">
          ${w.access_type === "invited"
            ? `<button data-action="accept-invite" data-id="${w.id}">Accept</button><button class="danger" data-action="decline-invite" data-id="${w.id}">Decline</button>`
            : `<button class="danger" data-action="delete-or-leave" data-id="${w.id}">${w.access_type === "owner" ? "Delete" : "Leave"}</button>`}
          ${isSelected ? "<strong>Selected</strong>" : ""}
        </div>
      </div>
    `;
  }).join("");
}

async function selectList(id) {
  selectedList = watchlists.find((w) => w.id === id) ?? null;
  if (!selectedList) return;

  currentListTitleEl.textContent = selectedList.name;
  renameInput.value = selectedList.name;
  ownerActionsEl.classList.toggle("hidden", selectedList.access_type !== "owner");
  addMovieForm.classList.remove("hidden");

  await loadMovies();
  await loadSharedUsers();
  renderWatchlists();
}

async function loadSharedUsers() {
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
}

async function loadMovies() {
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
}

async function tmdbSearch(query) {
  const url = `${SUPABASE_URL}/functions/v1/tmdb-proxy`;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ action: "search", query })
  });

  if (!res.ok) {
    return null;
  }

  return await res.json();
}

async function addMovieToSelectedList(title) {
  if (!selectedList) return;

  let mediaType = null;
  let tmdbId = null;
  let runtime = null;
  let numberOfEpisodes = null;

  const search = await tmdbSearch(title);
  const best = search?.results?.[0];

  if (best) {
    mediaType = best.media_type ?? null;
    tmdbId = best.id ?? null;

    if (mediaType === "movie") {
      const details = await fetch(`${SUPABASE_URL}/functions/v1/tmdb-proxy`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({ action: "movie", id: tmdbId })
      }).then((r) => r.ok ? r.json() : null);
      runtime = details?.runtime ?? null;
    }

    if (mediaType === "tv") {
      const details = await fetch(`${SUPABASE_URL}/functions/v1/tmdb-proxy`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({ action: "tv", id: tmdbId })
      }).then((r) => r.ok ? r.json() : null);
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
}

async function onSignIn(ev) {
  ev.preventDefault();
  const email = document.getElementById("signin-email").value.trim();
  const password = document.getElementById("signin-password").value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    setStatus(error.message, true);
    return;
  }

  await bootstrap();
}

async function onSignUp(ev) {
  ev.preventDefault();
  const email = document.getElementById("signup-email").value.trim();
  const username = document.getElementById("signup-username").value.trim();
  const password = document.getElementById("signup-password").value;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } }
  });

  if (error) {
    setStatus(error.message, true);
    return;
  }

  if (data.session?.user) {
    sessionUser = data.session.user;
    await ensureProfile(username);
    setStatus("Sign-up successful. You are signed in.");
    await bootstrap();
    return;
  }

  setStatus("Sign-up successful. Check your email to confirm your account, then sign in.");
}

async function bootstrap() {
  const { data } = await supabase.auth.getUser();
  sessionUser = data.user;

  if (!sessionUser) {
    authCard.classList.remove("hidden");
    appRoot.classList.add("hidden");
    return;
  }

  await ensureProfile(null);

  whoamiEl.textContent = sessionUser.email;
  authCard.classList.add("hidden");
  appRoot.classList.remove("hidden");

  await loadWatchlists();
}

async function removeMovie(movieId) {
  const { error } = await supabase
    .from("watchlist_movies")
    .delete()
    .eq("watchlist_id", selectedList.id)
    .eq("movie_id", movieId);
  if (error) throw error;
  await loadMovies();
}

async function saveMovieProgress(movieId) {
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
}

async function acceptInvite(listId) {
  const { error } = await supabase.rpc("accept_invitation", { p_watchlist_id: listId });
  if (error) throw error;
  await loadWatchlists();
}

async function declineInvite(listId) {
  const { error } = await supabase.rpc("decline_invitation", { p_watchlist_id: listId });
  if (error) throw error;
  await loadWatchlists();
}

async function deleteOrLeave(list) {
  if (list.access_type === "owner") {
    const { error } = await supabase.from("watchlists").delete().eq("id", list.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("watchlist_shares").delete().eq("watchlist_id", list.id).eq("user_id", sessionUser.id);
    if (error) throw error;
  }

  if (selectedList?.id === list.id) {
    selectedList = null;
  }

  await loadWatchlists();
}

async function removeSharedUser(userId) {
  if (!selectedList) return;
  const { error } = await supabase.from("watchlist_shares").delete().eq("watchlist_id", selectedList.id).eq("user_id", userId);
  if (error) throw error;
  await loadSharedUsers();
}

function wireEvents() {
  document.getElementById("signin-form").addEventListener("submit", (ev) => onSignIn(ev).catch((e) => setStatus(e.message, true)));
  document.getElementById("signup-form").addEventListener("submit", (ev) => onSignUp(ev).catch((e) => setStatus(e.message, true)));

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    selectedList = null;
    await bootstrap();
  });

  document.getElementById("new-list-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = document.getElementById("new-list-name").value.trim();
    if (!name) return;

    const { error } = await supabase.from("watchlists").insert({ name, owner_id: sessionUser.id });
    if (error) {
      setStatus(error.message, true);
      return;
    }

    document.getElementById("new-list-name").value = "";
    await loadWatchlists();
  });

  document.getElementById("rename-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!selectedList) return;
    const newName = renameInput.value.trim();
    if (!newName) return;

    const { error } = await supabase.from("watchlists").update({ name: newName }).eq("id", selectedList.id);
    if (error) {
      setStatus(error.message, true);
      return;
    }

    await loadWatchlists();
    setStatus("List renamed.");
  });

  document.getElementById("invite-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!selectedList) return;

    const username = document.getElementById("invite-username").value.trim();
    if (!username) return;

    const { error } = await supabase.rpc("invite_user_by_username", {
      p_watchlist_id: selectedList.id,
      p_username: username
    });

    if (error) {
      setStatus(error.message, true);
      return;
    }

    document.getElementById("invite-username").value = "";
    setStatus("Invite sent.");
  });

  addMovieForm.addEventListener("submit", async (ev) => {
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

  listsEl.addEventListener("click", async (ev) => {
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

  moviesEl.addEventListener("click", async (ev) => {
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

  sharedUsersEl.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn || btn.dataset.action !== "remove-shared-user") return;
    try {
      await removeSharedUser(btn.dataset.user);
    } catch (e) {
      setStatus(e.message, true);
    }
  });
}

wireEvents();
bootstrap().catch((e) => setStatus(e.message, true));
