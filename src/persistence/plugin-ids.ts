/**
 * Phase 4's plugin ids, and the ids qualified by category they became when the
 * plugins moved into their category folders (database version 3). Written out
 * rather than derived: the renames are history, and never change again.
 */
const QUALIFIED: Readonly<Record<string, string>> = {
  jellyfin: 'sources/jellyfin',
  emby: 'sources/emby',
  plex: 'sources/plex',
  webdav: 'sources/webdav',
  yattee: 'sources/yattee',
  invidious: 'sources/invidious',
  icloud: 'sources/icloud-drive',
  google: 'sources/google-drive',
  'custom-server': 'sync/custom-server',
};

/**
 * The id a stored connection's plugin has now. The mock split in two: a
 * connection that was the account went to the pretend account, any other to
 * the catalogue. An id this table does not know — already qualified, or a
 * plugin this app no longer ships — stays as it was.
 */
export function qualifiedIdOf(id: string, roles: Readonly<Record<string, unknown>>): string {
  if (id === 'mock') return roles.sync === true ? 'sync/mock' : 'sources/mock';
  return QUALIFIED[id] ?? id;
}

/**
 * A device's plugin states under their new ids. The mock's goes to both halves,
 * so neither disappears from a device that had it installed.
 */
export function qualifiedPluginStates(states: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [id, state] of Object.entries(states)) {
    if (id === 'mock') {
      next['sources/mock'] = state;
      next['sync/mock'] = state;
    } else {
      next[QUALIFIED[id] ?? id] = state;
    }
  }
  return next;
}

/**
 * Where a connection's session lives for a scope — `sessionRef` in
 * services/sessions, written out here because a migration never imports a
 * service: the format is history once a step has run.
 */
export function sessionRefOf(connectionId: string, scope: string): string {
  return `session:${connectionId}:${scope}`;
}
