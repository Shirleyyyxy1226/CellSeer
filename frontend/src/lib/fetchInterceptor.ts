/**
 * Global fetch interceptor that attaches the shared bearer token to every
 * same-origin /api/ request, so individual call sites (api.ts,
 * digibatApi.ts, analyseApi.ts, ad-hoc fetch() calls) don't each have to
 * know about auth.
 *
 * Safe to import multiple times: it installs only once per window.
 */

import { clearApiToken, getApiToken } from "@/lib/authToken";

const INSTALLED_FLAG = "__cellseerFetchInstalled" as const;

type Augmented = typeof window & { [INSTALLED_FLAG]?: boolean };

function shouldAttachToken(input: RequestInfo | URL): boolean {
  try {
    const url = typeof input === "string" || input instanceof URL
      ? String(input)
      : input.url;
    if (url.startsWith("/api/")) return true;
    // Absolute same-origin URL containing /api/
    if (typeof window !== "undefined") {
      const u = new URL(url, window.location.href);
      if (u.origin === window.location.origin && u.pathname.startsWith("/api/")) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function withAuthHeader(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return { ...(init ?? {}), headers };
}

export function installFetchInterceptor(): void {
  if (typeof window === "undefined") return;
  const w = window as Augmented;
  if (w[INSTALLED_FLAG]) return;
  w[INSTALLED_FLAG] = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let finalInit = init;
    if (shouldAttachToken(input)) {
      const token = getApiToken();
      if (token) {
        finalInit = withAuthHeader(init, token);
      }
    }
    const response = await originalFetch(input as RequestInfo, finalInit);
    // If the server tells us the token is bad, drop it so the user can
    // be re-handed a fresh URL with ?token=... without stale credentials
    // permanently in the way.
    if (response.status === 401 && shouldAttachToken(input)) {
      clearApiToken();
    }
    return response;
  };
}
