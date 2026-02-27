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

  const { name, access_type, owner_username } = listInfo;
  const isOwner   = access_type === "owner";
  const isShared  = access_type === "shared";
  const isInvited = access_type === "invited";
  const backHref  = `./index.html?listId=${listId}`;

  // Outer 3-column grid: back | center | action (trash)
  const grid = document.createElement("span");
  grid.style.cssText = "display:grid;grid-template-columns:1fr auto 1fr;align-items:start;width:100%;";

  // ── Back button (top-left) ──
  const backCol = document.createElement("span");
  backCol.style.justifySelf = "start";
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
  centerCol.style.cssText = "margin:0;display:flex;flex-direction:column;align-items:center;width:600px;max-width:100%;";

  // ── Right column (trash / leave) ──
  const rightCol = document.createElement("span");
  rightCol.style.justifySelf = "end";

  if (isOwner || isShared) {
    const trashBtn = document.createElement("button");
    trashBtn.type = "button";
    trashBtn.title = isOwner ? "Delete list" : "Leave shared list";
    trashBtn.style.cssText = "background:none;border:none;cursor:pointer;padding:0;";
    trashBtn.innerHTML = `<span class="bi bi-trash-fill" style="scale:1.5;color:red;margin-top:10px;display:inline-block;"></span>`;
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
    renameForm.style.cssText = "margin:0;display:flex;flex-direction:row;align-items:center;width:50%;gap:10px;";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "form-control";
    nameInput.value = currentName;
    nameInput.maxLength = 10;
    nameInput.required = true;
    nameInput.style.cssText = "font-size:1.75rem;font-weight:500;text-align:center;padding-top:0;padding-bottom:0;padding-left:0;padding-right:0;width:100%;";

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
    shareBox.style.cssText = "margin-top:20px;width:100%;border:1px solid currentColor;border-radius:5px;padding:12px;box-sizing:border-box;";

    const shareHeading = document.createElement("h5");
    shareHeading.style.margin = "0 0 10px 0";
    shareHeading.textContent = "Share Watchlist";

    const inviteRow = document.createElement("form");
    inviteRow.style.cssText = "display:flex;gap:8px;";

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
    sharedUsersList.style.cssText = "margin-top:10px;display:flex;flex-direction:column;gap:8px;";

    shareBox.append(shareHeading, inviteRow, shareMsg, sharedUsersList);
    centerCol.appendChild(shareBox);

    // Load shared users
    await refreshSharedUsers(sharedUsersList);

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
    actionsDiv.style.cssText = "display:flex;gap:10px;margin-top:10px;";

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
      row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;";
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
    showStatus(getErrorMessage(err, "Failed to initialize settings"), true);
  }
}

void main();
