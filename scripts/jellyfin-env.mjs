// Reads the local server file `start-jellyfin.mjs` uses. Pure, so it can be tested.

/** `key=value` lines; `#` comments, blank lines and surrounding quotes are ignored. */
export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at <= 0) continue;
    const key = trimmed.slice(0, at).trim().replace(/^export\s+/, '');
    values[key] = trimmed.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

/**
 * The server's API address: the web client's address without its `/web` part
 * (a base path such as `/jellyfin` is kept), or else the bare IP on Jellyfin's
 * default port.
 */
export function deriveServerUrl({ web_ui: webUi, ip }) {
  if (webUi) {
    let url = webUi.trim().replace(/#.*$/, '').replace(/\?.*$/, '');
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
    return url.replace(/\/web(\/.*)?$/i, '').replace(/\/+$/, '');
  }
  if (ip) {
    const host = ip.trim();
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `http://${host}`;
    return /:\d+(\/|$)/.test(withScheme.replace(/^[a-z]+:\/\//i, '')) ? withScheme : `${withScheme}:8096`;
  }
  return undefined;
}
