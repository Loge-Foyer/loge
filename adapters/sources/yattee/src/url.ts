/**
 * A server address as typed or pasted — often with the admin panel's own path
 * or a trailing slash — reduced to the API base.
 */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim();
  for (const marker of ['#', '?']) {
    const at = url.indexOf(marker);
    if (at >= 0) url = url.slice(0, at);
  }
  // `/api/v1/...` pasted from the docs, or `/admin` from the panel.
  return url
    .replace(/\/+$/, '')
    .replace(/\/(api(\/v1)?|admin)(\/.*)?$/i, '')
    .replace(/\/+$/, '');
}

export type QueryValue = string | number | boolean | undefined;

/** `?a=1&b=x%20y`, skipping absent values. */
export function queryString(params: Readonly<Record<string, QueryValue>>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}
