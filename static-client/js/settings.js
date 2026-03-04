/**
 * js/settings.js  —  Settings page entry point
 *
 * Matches original Settings.razor:
 * - Owner:   rename form, share-invite form, shared-users list, delete trash icon (top-right)
 * - Shared:  list name, "shared by" text, leave trash icon (top-right)
 * - Invited: list name, "shared by" text, Accept + Decline buttons
 */
import { initializeClerk } from "./clerk-init.js";
import {
  setClerk, apiFetch, ensureProfile, getCurrentUserIdentity,
  setGlobalAuthUi, getErrorMessage, showStatus,
} from "./api.js";

// ── DOM refs ──────────────────────────────────────────

const contentSurface   = document.getElementById("content-surface");
const logoutBtn        = document.getElementById("logout-btn");
const listsNavEl       = document.getElementById("lists");
const settingsContent  = document.getElementById("settings-content");

// ── State ─────────────────────────────────────────────
let clerk   = null;
const listId = parseInt(new URLSearchParams(window.location.search).get("listId") ?? "0", 10) || null;

// ── Spotlight (always on) ───────────────────────────
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

// ── Nav (sidebar list) for settings page ─────────────
async function renderNav() {
  if (!listsNavEl) return;
  listsNavEl.innerHTML = "";

  let lists = [];
  try {
    const rows = await apiFetch("/api/lists");
    lists = Array.isArray(rows) ? rows : [];
  } catch { return; }

  for (const list of lists) {
    const item = document.createElement("div");
    item.className = "nav-item";

    const link = document.createElement("a");
    // On the settings page all nav clicks navigate (no in-place JS load)
    if (list.access_type === "invited") {
      link.href = `./settings.html?listId=${list.id}`;
    } else {
      link.href = `./index.html?listId=${list.id}`;
    }
    link.className = "nav-link" + (list.id === listId ? " active" : "");

    const icon = document.createElement("span");
    icon.className = "bi bi-list-nested";
    icon.style.verticalAlign = "middle";
    link.append(icon, ` ${list.name}`);

    if (list.access_type === "invited") {
      const clock = document.createElement("span");
      clock.className = "bi bi-clock-fill pending-clock-icon";
      link.appendChild(clock);
    }

    item.appendChild(link);
    listsNavEl.appendChild(item);
  }

  // New List link → home page
  const newItem = document.createElement("div");
  newItem.className = "nav-item";
  const newLink = document.createElement("a");
  newLink.href = "./index.html";
  newLink.className = "nav-link";
  newLink.innerHTML = `<span class="bi bi-plus-square-fill" style="vertical-align:middle;"></span> New List`;
  newItem.appendChild(newLink);
  listsNavEl.appendChild(newItem);
}

// ── Settings page rendering ───────────────────────────
async function renderSettings() {
  if (!settingsContent) return;
  settingsContent.innerHTML = "";

  if (!listId) {
    settingsContent.innerHTML = "<h3>No list selected.</h3>";
    return;
  }

  // Show loading state while fetching
  settingsContent.innerHTML = "<h3>Loading settings...</h3>";

  // Fetch list info
  let listInfo;
  try {
    listInfo = await apiFetch(`/api/lists/${listId}/info`);
  } catch (err) {
    settingsContent.innerHTML = `<h3>${getErrorMessage(err, "List not found.")}</h3>`;
    return;
  }

  const { name, access_type, owner_username, is_read_only } = listInfo;
  const isOwner   = access_type === "owner";
  const isShared  = access_type === "shared";
  const isInvited = access_type === "invited";
  const backHref  = `./index.html?listId=${listId}`;

  // Outer 3-column grid: back | center | action (trash)
  const grid = document.createElement("div");
  grid.className = "settings-grid";

  // ── Back button (top-left) ──
  const backCol = document.createElement("span");
  backCol.className = "settings-start";
  const backLink = document.createElement("a");
  backLink.href = isInvited ? "./index.html" : backHref;
  backLink.className = "nav-link";
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "btn btn-primary";
  backBtn.innerHTML = `<span class="bi bi-arrow-left" style="vertical-align:top;"></span> Back`;
  backLink.appendChild(backBtn);
  backCol.appendChild(backLink);

  // ── Center column ──
  const centerCol = document.createElement("div");
  centerCol.className = "settings-center";

  // ── Right column (trash / leave) ──
  const rightCol = document.createElement("span");
  rightCol.className = "settings-end";

  if (isOwner || isShared) {
    const trashBtn = document.createElement("button");
    trashBtn.type = "button";
    trashBtn.title = isOwner ? "Delete list" : "Leave shared list";
    trashBtn.style.cssText = "background:none;border:none;cursor:pointer;padding:0;";
    trashBtn.innerHTML = `<span class="bi bi-trash-fill" style="color:red;display:inline-block;"></span>`;
    trashBtn.addEventListener("click", () => deleteOrLeave(listId, isOwner, name));
    rightCol.appendChild(trashBtn);
  } else {
    // Empty span so grid columns stay balanced (matches original)
    rightCol.appendChild(document.createElement("span"));
  }

  // ── Centre content depending on role ──

  if (isOwner) {
    // ─ Rename form ─
    let currentName = name;
    const renameForm = document.createElement("form");
    renameForm.className = "settings-rename-form";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "form-control settings-rename-input";
    nameInput.value = currentName;
    nameInput.maxLength = 10;
    nameInput.required = true;

    const saveNameBtn = document.createElement("button");
    saveNameBtn.type = "submit";
    saveNameBtn.className = "btn btn-primary";
    saveNameBtn.style.justifySelf = "end";
    saveNameBtn.innerHTML = `<span class="bi bi-check-lg" style="vertical-align:top;"></span>`;

    renameForm.append(nameInput, saveNameBtn);
    renameForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const newName = nameInput.value.trim();
      if (!newName) return;
      try {
        await apiFetch(`/api/lists/${listId}`, { method: "PATCH", body: { name: newName } });
        window.location.href = backHref;
      } catch (err) {
        showStatus(getErrorMessage(err, "Unable to rename"), true);
      }
    });

    centerCol.appendChild(renameForm);

    // ─ Share box ─
    const shareBox = document.createElement("div");
    shareBox.className = "share-box";

    const shareHeading = document.createElement("h5");
    shareHeading.style.margin = "0 0 10px 0";
    shareHeading.textContent = "Share Watchlist";

    const inviteRow = document.createElement("form");
    inviteRow.className = "share-invite-row";

    const usernameInput = document.createElement("input");
    usernameInput.type = "text";
    usernameInput.className = "form-control";
    usernameInput.placeholder = "Username";
    usernameInput.maxLength = 50;
    usernameInput.required = true;

    const inviteBtn = document.createElement("button");
    inviteBtn.type = "submit";
    inviteBtn.className = "btn btn-primary";
    inviteBtn.title = "Send invite";
    inviteBtn.style.cssText = "background-color:green;border-color:green;";
    inviteBtn.innerHTML = `<span class="bi bi-plus-lg" style="vertical-align:top;"></span>`;

    inviteRow.append(usernameInput, inviteBtn);

    const shareMsg = document.createElement("div");
    shareMsg.style.marginTop = "10px";

    inviteRow.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = usernameInput.value.trim();
      if (!username) return;
      try {
        await apiFetch(`/api/lists/${listId}/invite`, {
          method: "POST",
          body: { username },
        });
        usernameInput.value = "";
        shareMsg.innerHTML = `<div class="alert alert-success" style="margin-top:10px;margin-bottom:0;">Invite sent to ${username}.</div>`;
        await refreshSharedUsers(sharedUsersList);
      } catch (err) {
        shareMsg.innerHTML = `<div class="alert alert-danger" style="margin-top:10px;margin-bottom:0;">${getErrorMessage(err, "Unable to invite user")}</div>`;
      }
    });

    const sharedUsersList = document.createElement("div");
    sharedUsersList.className = "share-users-list";

    shareBox.append(shareHeading, inviteRow, shareMsg, sharedUsersList);
    centerCol.appendChild(shareBox);

    // Load shared users
    await refreshSharedUsers(sharedUsersList);

    // ─ Sharing settings box (read-only toggle) ─
    const settingsBox = document.createElement("div");
    settingsBox.className = "share-box";
    settingsBox.style.marginTop = "16px";

    const settingsHeading = document.createElement("h5");
    settingsHeading.style.margin = "0 0 12px 0";
    settingsHeading.textContent = "Sharing Settings";

    const toggleWrapper = document.createElement("div");
    toggleWrapper.className = "form-check form-switch";

    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.className = "form-check-input";
    toggleInput.id = "read-only-toggle";
    toggleInput.role = "switch";
    toggleInput.checked = !!is_read_only;

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "form-check-label";
    toggleLabel.htmlFor = "read-only-toggle";
    toggleLabel.textContent = "Read-only for shared users";

    const toggleDesc = document.createElement("div");
    toggleDesc.style.cssText = "font-size:0.82rem;color:#888;margin-top:6px;";
    toggleDesc.textContent = "When enabled, shared members can view the list and update their own watch progress, but cannot add, remove, or reorder items.";

    toggleWrapper.append(toggleInput, toggleLabel);
    settingsBox.append(settingsHeading, toggleWrapper, toggleDesc);
    centerCol.appendChild(settingsBox);

    toggleInput.addEventListener("change", async () => {
      try {
        await apiFetch(`/api/lists/${listId}`, {
          method: "PATCH",
          body: { is_read_only: toggleInput.checked },
        });
      } catch (err) {
        showStatus(getErrorMessage(err, "Unable to update setting"), true);
        toggleInput.checked = !toggleInput.checked; // revert on failure
      }
    });

  } else if (isInvited) {
    // ─ Pending invitation UI ─
    const h3 = document.createElement("h3");
    h3.style.margin = "0";
    h3.textContent = name;

    const h5 = document.createElement("h5");
    h5.style.marginTop = "20px";
    h5.textContent = owner_username
      ? `This watchlist has been shared with you by ${owner_username}.`
      : "This watchlist has been shared with you.";

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "settings-actions";

    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "btn btn-primary";
    acceptBtn.textContent = "Accept";

    const declineBtn = document.createElement("button");
    declineBtn.type = "button";
    declineBtn.className = "btn btn-outline-danger";
    declineBtn.textContent = "Decline";

    const msgDiv = document.createElement("div");

    acceptBtn.addEventListener("click", async () => {
      try {
        await apiFetch(`/api/lists/${listId}/accept`, { method: "POST" });
        window.location.href = `./index.html?listId=${listId}`;
      } catch (err) {
        msgDiv.innerHTML = `<div class="alert alert-danger">${getErrorMessage(err, "Unable to accept")}</div>`;
      }
    });

    declineBtn.addEventListener("click", async () => {
      if (!confirm(`Decline invitation to "${name}"?`)) return;
      try {
        await apiFetch(`/api/lists/${listId}/decline`, { method: "POST" });
        window.location.href = "./index.html";
      } catch (err) {
        msgDiv.innerHTML = `<div class="alert alert-danger">${getErrorMessage(err, "Unable to decline")}</div>`;
      }
    });

    actionsDiv.append(acceptBtn, declineBtn);
    centerCol.append(h3, h5, actionsDiv, msgDiv);

  } else {
    // ─ Shared (non-owner, accepted) ─
    const h3 = document.createElement("h3");
    h3.style.margin = "0";
    h3.textContent = name;

    const h5 = document.createElement("h5");
    h5.style.marginTop = "20px";
    h5.textContent = owner_username
      ? `This list is shared with you by ${owner_username}.`
      : "This list is shared with you.";

    centerCol.append(h3, h5);
  }

  grid.append(backCol, centerCol, rightCol);
  settingsContent.innerHTML = "";
  settingsContent.appendChild(grid);
}

// ── Shared-users list refresh ─────────────────────────
async function refreshSharedUsers(container) {
  if (!container) return;
  container.innerHTML = "";
  try {
    const users = await apiFetch(`/api/lists/${listId}/shared-users`);
    if (!Array.isArray(users) || !users.length) {
      container.innerHTML = "<span>No shared users yet.</span>";
      return;
    }
    for (const u of users) {
      const row = document.createElement("div");
      row.className = "share-user-row";
      const label = document.createElement("span");
      label.textContent = u.username || u.user_id;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-outline-danger btn-sm";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", async () => {
        try {
          await apiFetch(`/api/lists/${listId}/shared-users/${encodeURIComponent(u.user_id)}`, {
            method: "DELETE",
          });
          await refreshSharedUsers(container);
        } catch (err) {
          showStatus(getErrorMessage(err, "Unable to remove user"), true);
        }
      });
      row.append(label, removeBtn);
      container.appendChild(row);
    }
  } catch {
    container.innerHTML = "<span>Unable to load shared users.</span>";
  }
}

// ── Delete / Leave ────────────────────────────────────
async function deleteOrLeave(id, isOwner, name) {
  const verb = isOwner ? "Delete" : "Leave";
  if (!confirm(`${verb} "${name}"?`)) return;
  try {
    await apiFetch(`/api/lists/${id}`, { method: "DELETE" });
    window.location.href = "./index.html";
  } catch (err) {
    showStatus(getErrorMessage(err, `Unable to ${verb.toLowerCase()} list`), true);
  }
}

// ── Entry point ───────────────────────────────────────
async function main() {
  initSpotlightToggle();
  initMobileNav();

  try {
    clerk = await initializeClerk();
    setClerk(clerk);

    if (!clerk.user) {
      setGlobalAuthUi(false);
      return;
    }

    const { username, email } = getCurrentUserIdentity();
    setGlobalAuthUi(true, username || email);

    logoutBtn?.addEventListener("click", async () => {
      await clerk.signOut();
      setGlobalAuthUi(false);
      window.location.href = "./index.html";
    });

    await ensureProfile();
    await Promise.all([renderNav(), renderSettings()]);

    clerk.addListener(({ user }) => {
      if (!user) {
        setGlobalAuthUi(false);
        window.location.href = "./index.html";
      }
    });
  } catch (err) {
    console.error("[settings] init failed:", err);
  }
}

void main();
