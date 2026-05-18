export function getProjectIdFromPathname(pathname: string): string | undefined {
  const m = pathname.match(/^\/projects\/([^/]+)(?:\/|$)/);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export function currentProjectIdFromLocation(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return getProjectIdFromPathname(window.location.pathname);
}

export function withProjectQuery(url: string, projectId?: string): string {
  const pid = projectId || currentProjectIdFromLocation();
  if (!pid) return url;
  const hasQuery = url.includes('?');
  const hasProject = /(?:\?|&)projectId=/.test(url);
  if (hasProject) return url;
  return `${url}${hasQuery ? '&' : '?'}projectId=${encodeURIComponent(pid)}`;
}

