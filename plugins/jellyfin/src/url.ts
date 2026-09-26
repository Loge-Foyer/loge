/**
 * A server address as typed or pasted — often the web client's own address,
 * such as `http://host:8096/web/#/home` — reduced to the API base.
 */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim();
  for (const marker of ['#', '?']) {
    const at = url.indexOf(marker);
    if (at >= 0) url = url.slice(0, at);
  }
  return url.replace(/\/+$/, '').replace(/\/web(\/.*)?$/i, '').replace(/\/+$/, '');
}

export type QueryValue = string | number | boolean | readonly string[] | undefined;

/** `?a=1&b=x%20y`, skipping absent values and joining lists with commas, as Jellyfin expects. */
export function queryString(params: Readonly<Record<string, QueryValue>>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const text = Array.isArray(value) ? value.join(',') : String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(text)}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}
