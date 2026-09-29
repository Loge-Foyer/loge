/**
 * The server's address as typed or pasted, reduced to the base every route
 * hangs off: no query, no fragment, no trailing slash. A base path stays —
 * behind a reverse proxy, the server may live under one.
 */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim();
  for (const marker of ['#', '?']) {
    const at = url.indexOf(marker);
    if (at >= 0) url = url.slice(0, at);
  }
  return url.replace(/\/+$/, '');
}

/** Host and port, to name the account by: never a scheme, a path, or credentials typed into the address. */
export function hostOf(baseUrl: string): string {
  const rest = baseUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const end = rest.indexOf('/');
  const authority = end < 0 ? rest : rest.slice(0, end);
  return authority.slice(authority.lastIndexOf('@') + 1);
}
