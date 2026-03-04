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
  // Determine if the current user is blocked from editing this list.
  // Owners always have full access; shared/invited users are blocked on read-only lists.
  const _activeList = _getActiveList();
  const isReadOnly = !!(_activeList?.is_read_only && _activeList?.access_type !== 'owner');

  const wrapper = document.createElement("div");
  wrapper.className = "movie-item";
  wrapper.draggable = !isReadOnly;
  wrapper.dataset.movieId = String(movie.id);

  // ── Drag handle (only shown when the user can reorder) ──
  const dragHandle = document.createElement("span");
  dragHandle.className = "bi bi-grip-vertical drag-handle";
  dragHandle.title = "Drag to reorder";
  if (isReadOnly) dragHandle.style.display = "none";
  wrapper.appendChild(dragHandle);

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
  const isTV         = movie.media_type === "tv";
  const isMovie      = movie.media_type === "movie";
  const isCollection = movie.media_type === "collection";

  if (isCollection) {
    // Collections show item count
    const count = movie.collection_item_count ?? 0;
    metaSpan.append(` - ${count} item${count === 1 ? '' : 's'}`);
  } else if (isMovie || isTV) {
    const icon = document.createElement("img");
    icon.src = isTV ? "./images/episodes.png" : "./images/clapperboard.png";
    icon.loading = "lazy";
    icon.style.cssText = "width:auto;height:1.1em;vertical-align:middle;";

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

  // Arrow button inline after the text, collections only
  if (isCollection && movie.collection_list_id) {
    const arrowBtn = document.createElement("button");
    arrowBtn.type = "button";
    arrowBtn.className = "movie-item-collection-btn";
    arrowBtn.title = "Open collection";
    arrowBtn.innerHTML = `<span class="bi bi-arrow-right-circle-fill" style="vertical-align:top;color:#000;"></span>`;
    arrowBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (typeof window.selectCollection === "function") {
        window.selectCollection(movie.collection_list_id);
      }
    });
    viewNodes.push(arrowBtn);
  }

  // Star rating (not shown for collections)
  if (!isCollection && movie.rating >= 1 && movie.rating <= 5) {
    const ratingSpan = document.createElement("span");
    ratingSpan.style.cssText = "color:#000;font-size:0.95em;";
    ratingSpan.textContent = ` - ${"★".repeat(movie.rating)}${"☆".repeat(5 - movie.rating)}`;
    viewNodes.push(ratingSpan);
  }

  // Edit button — at the far right, hidden entirely for non-owners on read-only lists
  let editBtn = null;
  if (!isReadOnly) {
    editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "movie-item-edit-btn";
    editBtn.style.cssText = "margin-left:auto;flex-shrink:0;";
    editBtn.innerHTML =
      `<span class="bi bi-pen-fill" style="vertical-align:top;scale:1;color:#60a5fa;"></span>`;
    viewNodes.push(editBtn);
  }

  viewNodes.forEach(n => wrapper.appendChild(n));

  // ══════════════════════════
  //  EDIT MODE elements
  // ══════════════════════════
  const editDiv = document.createElement("div");
  editDiv.className = "movie-item-edit-row hidden";
  editDiv.style.display = "none"; // layout controlled by .movie-item-edit-row CSS class (responsive)

  // Title input
  const titleInput = document.createElement("input");
  titleInput.className = "form-control edit-title-input";
  titleInput.type = "text";
  titleInput.maxLength = 80;
  titleInput.placeholder = "Title";
  titleInput.disabled = isReadOnly;
  // no inline style — .edit-title-input CSS class (and its responsive override) handles sizing

  // Type select
  const typeSelect = document.createElement("select");
  typeSelect.className = "form-select edit-type-select";
  typeSelect.disabled = isReadOnly;
  // no inline style — .edit-type-select CSS class handles sizing
  const inSubList = typeof window.isSubListView === "function" && window.isSubListView();
  typeSelect.innerHTML =
    `<option value="">Unknown</option>` +
    `<option value="movie">Movie</option>` +
    `<option value="tv">TV</option>` +
    (inSubList ? "" : `<option value="collection">Collection</option>`);

  // Rating select
  const ratingSelect = document.createElement("select");
  ratingSelect.className = "form-select edit-rating-select";
  // no inline style — .edit-rating-select CSS class handles sizing
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

  // Delete is not available on read-only lists for non-owners.
  if (isReadOnly) {
    editDiv.append(titleInput, typeSelect, ratingSelect, saveBtn, cancelBtn);
  } else {
    editDiv.append(titleInput, typeSelect, ratingSelect, saveBtn, cancelBtn, deleteBtn);
  }

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
    // no inline style — .edit-num-input CSS class (and its responsive override) handles sizing

    const sep = document.createElement("span");
    sep.className = "num-field";
    sep.textContent = "/";

    const tot = document.createElement("input");
    tot.type = "number";
    tot.min = "1";
    tot.className = "form-control edit-num-input num-field";
    tot.placeholder = t === "movie" ? "Total min" : "Total eps";
    tot.disabled = isReadOnly;
    // no inline style — .edit-num-input CSS class handles sizing

    watchedInput = w;
    totalInput = tot;

    // Insert before ratingSelect
    editDiv.insertBefore(w, ratingSelect);
    editDiv.insertBefore(sep, ratingSelect);
    editDiv.insertBefore(tot, ratingSelect);
  };

  typeSelect.addEventListener("change", () => {
    rebuildNumericFields();
    // Hide rating for collection type (collections don't have star ratings)
    ratingSelect.style.display = typeSelect.value === "collection" ? "none" : "";
  });

  // ── Show / hide helpers ──
  const showView = () => {
    dragHandle.style.display = isReadOnly ? "none" : "";
    viewNodes.forEach(n => { n.style.display = ""; });
    editDiv.classList.add("hidden");
    editDiv.style.display = "none";
    wrapper.draggable = !isReadOnly;
  };

  const showEdit = () => {
    dragHandle.style.display = "none";
    // Reset inputs to current (potentially just-updated) movie values
    titleInput.value = movie.title;
    typeSelect.value = movie.media_type || "";
    ratingSelect.value = movie.rating != null ? String(movie.rating) : "";
    ratingSelect.style.display = typeSelect.value === "collection" ? "none" : "";
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
    wrapper.draggable = false;
    viewNodes.forEach(n => { n.style.display = "none"; });
    editDiv.classList.remove("hidden");
    editDiv.style.display = "flex";
  };

  // ── Wire events ──
  if (editBtn) editBtn.addEventListener("click", showEdit);
  cancelBtn.addEventListener("click", showView);

  saveBtn.addEventListener("click", async () => {
    const t = typeSelect.value;
    const list = _getActiveList();
    const patch = {
      list_id: list?.id ?? undefined,
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
      const wasCollection = !!movie.collection_list_id;
      Object.assign(movie, updated);
      wrapper.replaceWith(buildMovieItem(movie));
      // Refresh nav sub-lists if a collection was created, updated, or removed
      if (t === 'collection' || wasCollection) {
        window.refreshSubLists?.();
      }
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
      if (isCollection) window.refreshSubLists?.();
    } catch (err) {
      showStatus(getErrorMessage(err, "Unable to remove"), true);
    }
  });

  wrapper.appendChild(editDiv);
  return wrapper;
}

// ──────────────────────────────────────────────────────

export function renderMovies(movies = [], moviesEl, listId) {
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
  const _renderList = _getActiveList();
  const canReorder = !_renderList?.is_read_only || _renderList?.access_type === 'owner';
  if (listId && canReorder) initDragAndDrop(container, listId);
  moviesEl.appendChild(container);

  // On touch devices, briefly highlight the first item so users know they can tap to edit
  if (movies.length && 'ontouchstart' in window) {
    const firstItem = container.querySelector('.movie-item');
    if (firstItem) {
      firstItem.classList.add('touch-active');
      setTimeout(() => firstItem.classList.remove('touch-active'), 2000);
    }
  }
}

export async function loadMovies(listId, moviesEl) {
  if (moviesEl) {
    moviesEl.innerHTML = "";
    const loading = document.createElement("h4");
    loading.textContent = "Loading watchlist...";
    moviesEl.appendChild(loading);
  }
  const rows = await apiFetch(`/api/lists/${listId}/movies`);
  renderMovies(Array.isArray(rows) ? rows : [], moviesEl, listId);
}

// ── Drag-and-drop reordering ────────────────────────────────
function initDragAndDrop(container, listId) {
  initTouchDragAndDrop(container, listId);
  let dragSrc = null;

  container.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".movie-item");
    if (!item) return;
    dragSrc = item;
    // Delay class addition so the ghost image captures the normal style
    requestAnimationFrame(() => item.classList.add("dragging"));
    e.dataTransfer.effectAllowed = "move";
  });

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const item = e.target.closest(".movie-item");
    if (!item || item === dragSrc) return;
    // Show insertion line above or below
    const mid = item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2;
    container.querySelectorAll(".movie-item").forEach(el =>
      el.classList.remove("drag-over-top", "drag-over-bottom")
    );
    item.classList.add(e.clientY < mid ? "drag-over-top" : "drag-over-bottom");
  });

  container.addEventListener("dragleave", (e) => {
    if (!container.contains(e.relatedTarget)) {
      container.querySelectorAll(".movie-item").forEach(el =>
        el.classList.remove("drag-over-top", "drag-over-bottom")
      );
    }
  });

  container.addEventListener("drop", async (e) => {
    e.preventDefault();
    const target = e.target.closest(".movie-item");
    container.querySelectorAll(".movie-item").forEach(el =>
      el.classList.remove("drag-over-top", "drag-over-bottom", "dragging")
    );
    if (!target || !dragSrc || target === dragSrc) { dragSrc = null; return; }

    const mid = target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
    if (e.clientY < mid) {
      container.insertBefore(dragSrc, target);
    } else {
      target.after(dragSrc);
    }
    dragSrc = null;

    const ids = [...container.querySelectorAll(".movie-item")].map(el => Number(el.dataset.movieId));
    try {
      await apiFetch(`/api/lists/${listId}/movies/reorder`, {
        method: "PATCH",
        body: { ids },
      });
    } catch (err) {
      showStatus(getErrorMessage(err, "Unable to save order"), true);
    }
  });

  container.addEventListener("dragend", () => {
    container.querySelectorAll(".movie-item").forEach(el =>
      el.classList.remove("dragging", "drag-over-top", "drag-over-bottom")
    );
    dragSrc = null;
  });
}

// ── Touch drag-and-drop reordering (mobile) ───────────────────
function initTouchDragAndDrop(container, listId) {
  let dragSrc = null;

  container.addEventListener("touchstart", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle) return;
    const item = handle.closest(".movie-item");
    if (!item) return;
    dragSrc = item;
    item.classList.add("dragging");
    e.preventDefault();
  }, { passive: false });

  container.addEventListener("touchmove", (e) => {
    if (!dragSrc) return;
    e.preventDefault();
    const touch = e.touches[0];
    // Temporarily hide the dragged item so elementFromPoint finds what's underneath
    dragSrc.style.visibility = "hidden";
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    dragSrc.style.visibility = "";
    const target = el?.closest(".movie-item");
    container.querySelectorAll(".movie-item").forEach(i =>
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
    const target = el?.closest(".movie-item");
    container.querySelectorAll(".movie-item").forEach(i =>
      i.classList.remove("drag-over-top", "drag-over-bottom", "dragging")
    );
    if (target && target !== dragSrc) {
      const rect = target.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (touch.clientY < mid) {
        container.insertBefore(dragSrc, target);
      } else {
        target.after(dragSrc);
      }
      const ids = [...container.querySelectorAll(".movie-item")].map(el => Number(el.dataset.movieId));
      try {
        await apiFetch(`/api/lists/${listId}/movies/reorder`, {
          method: "PATCH",
          body: { ids },
        });
      } catch (err) {
        showStatus(getErrorMessage(err, "Unable to save order"), true);
      }
    }
    dragSrc = null;
  });
}
