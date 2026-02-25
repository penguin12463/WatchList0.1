/**
 * movies.js
 * buildMovieItem() — pixel-perfect match to MovieItem.razor (view + edit modes).
 * renderMovies()   — renders the movie list container.
 * loadMovies()     — fetches and renders.
 */
import { apiFetch, getErrorMessage, showStatus } from "./api.js";

// Injected by app.js so movie items know the active list
let _getActiveList = () => null;

export function setActiveListGetter(fn) {
  _getActiveList = fn;
}

// ──────────────────────────────────────────────────────

export function buildMovieItem(movie) {
  const wrapper = document.createElement("div");
  wrapper.className = "movie-item";

  // ── Dot (always visible) ──
  const dot = document.createElement("span");
  dot.className = "bi bi-circle-fill movie-dot";
  dot.style.cssText = "scale:0.5;vertical-align:top;flex-shrink:0;";
  wrapper.appendChild(dot);

  // ══════════════════════════
  //  VIEW MODE elements
  // ══════════════════════════
  const viewNodes = [];

  const titleSpan = document.createElement("span");
  titleSpan.className = "movie-title";
  titleSpan.textContent = movie.title;
  viewNodes.push(titleSpan);

  // Media-type meta  ("- [icon] - X/Y min" etc.)
  const metaSpan = document.createElement("span");
  metaSpan.style.cssText = "color:#000;font-size:0.95em;";
  const isTV    = movie.media_type === "tv";
  const isMovie = movie.media_type === "movie";

  if (isMovie || isTV) {
    const icon = document.createElement("i");
    icon.className = isTV ? "bi bi-display" : "bi bi-film";
    icon.style.cssText = "width:1.1em;height:auto;vertical-align:middle;";

    metaSpan.append(" - ");
    metaSpan.appendChild(icon);

    if (isMovie) {
      metaSpan.append(
        movie.runtime != null
          ? ` - ${movie.watched_runtime ?? 0}/${movie.runtime} min`
          : " - Length Not Found"
      );
    } else {
      metaSpan.append(
        movie.number_of_episodes != null
          ? ` - ${movie.watched_episodes ?? 0}/${movie.number_of_episodes} episodes`
          : " - Length Not Found"
      );
    }
  } else {
    metaSpan.textContent = " - Type and length unknown";
  }
  viewNodes.push(metaSpan);

  // Star rating
  if (movie.rating >= 1 && movie.rating <= 5) {
    const ratingSpan = document.createElement("span");
    ratingSpan.style.cssText = "color:#000;font-size:0.95em;";
    ratingSpan.textContent = ` - ${"★".repeat(movie.rating)}${"☆".repeat(5 - movie.rating)}`;
    viewNodes.push(ratingSpan);
  }

  // Edit button (btn-link style, blue pen with black outline)
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "movie-item-edit-btn";
  editBtn.innerHTML =
    `<span class="bi bi-pen-fill" style="vertical-align:top;scale:1;` +
    `color:#60a5fa;text-shadow:-1px 0 #000,0 1px #000,1px 0 #000,0 -1px #000;"></span>`;
  viewNodes.push(editBtn);

  viewNodes.forEach(n => wrapper.appendChild(n));

  // ══════════════════════════
  //  EDIT MODE elements
  // ══════════════════════════
  const editDiv = document.createElement("div");
  editDiv.className = "movie-item-edit-row hidden";
  editDiv.style.cssText = "display:none;align-items:center;gap:8px;width:100%;flex-wrap:nowrap;";

  // Title input
  const titleInput = document.createElement("input");
  titleInput.className = "form-control edit-title-input";
  titleInput.type = "text";
  titleInput.maxLength = 80;
  titleInput.placeholder = "Title";
  titleInput.style.cssText = "width:140px;min-width:140px;flex:0 0 140px;padding:0 5px;";

  // Type select
  const typeSelect = document.createElement("select");
  typeSelect.className = "form-select edit-type-select";
  typeSelect.style.cssText = "width:auto;min-width:110px;padding:0 5px;";
  typeSelect.innerHTML =
    `<option value="">Unknown</option>` +
    `<option value="movie">Movie</option>` +
    `<option value="tv">TV</option>`;

  // Rating select
  const ratingSelect = document.createElement("select");
  ratingSelect.className = "form-select edit-rating-select";
  ratingSelect.style.cssText = "width:auto;min-width:100px;padding:0 5px;";
  ratingSelect.innerHTML =
    `<option value="">No rating</option>` +
    [1, 2, 3, 4, 5].map(n =>
      `<option value="${n}">${"★".repeat(n)}${"☆".repeat(5 - n)}</option>`
    ).join("");

  // Action buttons
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn btn-primary edit-action-btn";
  saveBtn.style.padding = "0 5px";
  saveBtn.innerHTML = `<span class="bi bi-check-lg" style="vertical-align:top;"></span>`;

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-outline-secondary edit-action-btn";
  cancelBtn.style.padding = "0 5px";
  cancelBtn.innerHTML = `<span class="bi bi-x-lg" style="vertical-align:top;"></span>`;

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-primary edit-action-btn";
  deleteBtn.style.cssText = "padding:0 5px;background-color:red;border-color:red;";
  deleteBtn.innerHTML = `<span class="bi bi-trash" style="vertical-align:top;color:white;"></span>`;

  editDiv.append(titleInput, typeSelect, ratingSelect, saveBtn, cancelBtn, deleteBtn);

  // Watched / total numeric fields — rebuilt when type changes
  let watchedInput = null, totalInput = null;

  const rebuildNumericFields = () => {
    editDiv.querySelectorAll(".num-field").forEach(e => e.remove());
    watchedInput = null;
    totalInput = null;
    const t = typeSelect.value;
    if (t !== "movie" && t !== "tv") return;

    const w = document.createElement("input");
    w.type = "number";
    w.min = "0";
    w.className = "form-control edit-num-input num-field";
    w.placeholder = "Watched";
    w.style.cssText = "width:110px;padding:0 5px;";

    const sep = document.createElement("span");
    sep.className = "num-field";
    sep.textContent = "/";

    const tot = document.createElement("input");
    tot.type = "number";
    tot.min = "1";
    tot.className = "form-control edit-num-input num-field";
    tot.placeholder = t === "movie" ? "Total min" : "Total eps";
    tot.style.cssText = "width:110px;padding:0 5px;";

    watchedInput = w;
    totalInput = tot;

    // Insert before ratingSelect
    editDiv.insertBefore(w, ratingSelect);
    editDiv.insertBefore(sep, ratingSelect);
    editDiv.insertBefore(tot, ratingSelect);
  };

  typeSelect.addEventListener("change", rebuildNumericFields);

  // ── Show / hide helpers ──
  const showView = () => {
    viewNodes.forEach(n => { n.style.display = ""; });
    editDiv.classList.add("hidden");
    editDiv.style.display = "none";
  };

  const showEdit = () => {
    // Reset inputs to current (potentially just-updated) movie values
    titleInput.value = movie.title;
    typeSelect.value = movie.media_type || "";
    ratingSelect.value = movie.rating != null ? String(movie.rating) : "";
    rebuildNumericFields();
    if (watchedInput) {
      watchedInput.value = isTV
        ? (movie.watched_episodes ?? "")
        : (movie.watched_runtime ?? "");
    }
    if (totalInput) {
      totalInput.value = isTV
        ? (movie.number_of_episodes ?? "")
        : (movie.runtime ?? "");
    }
    viewNodes.forEach(n => { n.style.display = "none"; });
    editDiv.classList.remove("hidden");
    editDiv.style.display = "flex";
  };

  // ── Wire events ──
  editBtn.addEventListener("click", showEdit);
  cancelBtn.addEventListener("click", showView);

  saveBtn.addEventListener("click", async () => {
    const t = typeSelect.value;
    const patch = {
      title: titleInput.value.trim() || movie.title,
      media_type: t || null,
      watched_runtime:      t === "movie" ? (Number(watchedInput?.value) || null) : null,
      runtime:              t === "movie" ? (Number(totalInput?.value) || null) : null,
      watched_episodes:     t === "tv"    ? (Number(watchedInput?.value) || null) : null,
      number_of_episodes:   t === "tv"    ? (Number(totalInput?.value) || null) : null,
      rating: ratingSelect.value ? Number(ratingSelect.value) : null,
    };
    try {
      const updated = await apiFetch(`/api/movies/${movie.id}`, {
        method: "PATCH",
        body: patch,
      });
      Object.assign(movie, updated);
      wrapper.replaceWith(buildMovieItem(movie));
    } catch (err) {
      showStatus(getErrorMessage(err, "Unable to save"), true);
    }
  });

  deleteBtn.addEventListener("click", async () => {
    const list = _getActiveList();
    if (!list) return;
    if (!confirm(`Remove "${movie.title}" from this list?`)) return;
    try {
      await apiFetch(`/api/lists/${list.id}/movies/${movie.id}`, {
        method: "DELETE",
      });
      wrapper.remove();
    } catch (err) {
      showStatus(getErrorMessage(err, "Unable to remove"), true);
    }
  });

  wrapper.appendChild(editDiv);
  return wrapper;
}

// ──────────────────────────────────────────────────────

export function renderMovies(movies = [], moviesEl) {
  if (!moviesEl) return;
  moviesEl.innerHTML = "";

  if (!movies.length) {
    const h4 = document.createElement("h4");
    h4.textContent = "This list has no movies yet.";
    moviesEl.appendChild(h4);
    return;
  }

  const container = document.createElement("div");
  container.className = "movie-list-container";
  movies.forEach(m => container.appendChild(buildMovieItem(m)));
  moviesEl.appendChild(container);
}

export async function loadMovies(listId, moviesEl) {
  const rows = await apiFetch(`/api/lists/${listId}/movies`);
  renderMovies(Array.isArray(rows) ? rows : [], moviesEl);
}
