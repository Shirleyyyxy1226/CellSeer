/**
 * Shared bearer-token bootstrap for the SPA.
 *
 * Behaviour:
 *   1. On import, look for `?token=...` in the current URL. If present,
 *      persist it to localStorage and strip the query param from the URL
 *      so it doesn't leak into the address bar / bookmarks / referrer.
 *   2. `getApiToken()` returns the currently-stored token (or null).
 *
 * This is intentionally minimal — the deployment hands out a URL like
 *   https://cellseer.com/?token=XYZ
 * on first share, the browser captures the token once, and every
 * subsequent /api/ call sends it via the Authorization header (wired up
 * by the global fetch interceptor in `fetchInterceptor.ts`).
 */

const STORAGE_KEY = "cellseer.apiToken";

function captureTokenFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token");
    if (token && token.trim()) {
      window.localStorage.setItem(STORAGE_KEY, token.trim());
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.toString());
    }
  } catch {
    // Browser may block localStorage in some embed contexts; ignore.
  }
}

captureTokenFromUrl();

export function getApiToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearApiToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
