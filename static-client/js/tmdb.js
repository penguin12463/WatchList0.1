/**
 * tmdb.js
 * Autocomplete search using the TMDB proxy endpoints on the worker.
 */
import { apiFetch } from "./api.js";

let _titleInput = null;
let _resultsEl  = null;
let _onSelect   = null;    // callback(selectedData)
let _searchTimer = null;

export function initTmdbSearch(titleInputEl, resultsEl, onSelectCallback) {
  _titleInput = titleInputEl;
  _resultsEl  = resultsEl;
  _onSelect   = onSelectCallback;

  if (!_titleInput) return;

  _titleInput.addEventListener("input", () => {
    const q = (_titleInput.value || "").trim();
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => _doSearch(q), 400);
  });

  _titleInput.addEventListener("blur", () => {
    // Small delay so mousedown on a result can fire first
    setTimeout(_hide, 200);
  });
}

export function hideTmdbResults() {
  _hide();
}

// ── Internal ─────────────────────────────────────────

function _hide() {
  if (!_resultsEl) return;
  _resultsEl.innerHTML = "";
  _resultsEl.classList.add("hidden");
}

async function _doSearch(query) {
  if (!query || query.length < 2) { _hide(); return; }
  try {
    const data = await apiFetch(`/api/tmdb/search?q=${encodeURIComponent(query)}`);
    _show(data?.results || []);
  } catch {
    _hide();
  }
}

function _show(results) {
  if (!_resultsEl) return;
  _resultsEl.innerHTML = "";

  if (!results.length) { _resultsEl.classList.add("hidden"); return; }

  for (const r of results) {
    const item = document.createElement("div");
    item.className = "tmdb-result-item";

    const icon = document.createElement("i");
    icon.className = r.media_type === "tv" ? "bi bi-display" : "bi bi-film";

    const titleSpan = document.createElement("span");
    titleSpan.style.flex = "1";
    titleSpan.textContent = r.title;

    const metaSpan = document.createElement("span");
    metaSpan.className = "tmdb-year";
    const parts = [];
    if (r.year) parts.push(r.year);
    if (r.runtime) parts.push(`${r.runtime} min`);
    metaSpan.textContent = parts.join(" · ");

    item.append(icon, titleSpan, metaSpan);

    // mousedown fires before blur so we can capture the selection
    item.addEventListener("mousedown", async (e) => {
      e.preventDefault();
      if (_titleInput) _titleInput.value = r.title;
      _hide();

      // Fetch full detail for runtime / episode count
      try {
        const detail = r.media_type === "tv"
          ? await apiFetch(`/api/tmdb/tv/${r.id}`)
          : await apiFetch(`/api/tmdb/movie/${r.id}`);
        _onSelect?.({
          title: r.title,
          media_type: r.media_type,
          tmdb_id: r.id,
          runtime: r.media_type === "movie" ? (detail?.runtime ?? null) : null,
          number_of_episodes: r.media_type === "tv" ? (detail?.number_of_episodes ?? null) : null,
        });
      } catch {
        _onSelect?.({ title: r.title, media_type: r.media_type, tmdb_id: r.id });
      }
    });

    _resultsEl.appendChild(item);
  }

  _resultsEl.classList.remove("hidden");
}
