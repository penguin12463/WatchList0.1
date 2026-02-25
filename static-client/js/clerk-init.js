/**
 * clerk-init.js
 * Handles Clerk SDK loading and token retrieval.
 */
import { CLERK_PUBLISHABLE_KEY } from "../config.js";

export async function initializeClerk() {
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
  return window.Clerk;
}

export async function getAuthToken(clerk) {
  const session = clerk?.session;
  if (!session) return null;
  return session.getToken({ skipCache: true });
}
