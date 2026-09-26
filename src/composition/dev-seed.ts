import type { Plugin } from '@sc/api';

import type { Services } from '@/services';
import { initialDraft, setSecret, setValue } from '@/services/connection-draft';

import { jellyfinPlugin, mockPlugin } from './plugins';

/**
 * `EXPO_PUBLIC_DEV_SEED`: `1` opens as Kids; `locked` opens on Alex's PIN pad;
 * `jellyfin` adds the server `npm run start:jellyfin` read from `jellyfin.env`.
 */
export type DevSeed = 'open' | 'locked' | 'jellyfin';

export function devSeedFrom(value: string | undefined): DevSeed | null {
  if (value === '1') return 'open';
  if (value === 'locked') return 'locked';
  if (value === 'jellyfin') return 'jellyfin';
  return null;
}

interface Server {
  readonly url: string;
  readonly username: string;
  readonly password: string;
}

/**
 * Storage is in memory for now, so every reload is a first launch. A seeded
 * development build starts past it: two profiles — Kids, and Alex with PIN
 * 1234 — and one connection. Which profile is the device default decides the
 * boot branch you land on.
 */
export async function seedDevelopmentData(services: Services, seed: DevSeed): Promise<void> {
  const kids = await services.profiles.create('Kids');
  const alex = await services.profiles.create('Alex');
  await services.pins.create(alex.id, '1234');
  await services.profiles.setDefault(seed === 'locked' ? alex.id : kids.id);

  if (seed === 'jellyfin') {
    const server = serverFromEnvironment();
    if (server) {
      await connect(services, jellyfinPlugin, kids.id, server);
      return;
    }
    console.warn('[app.boot] EXPO_PUBLIC_DEV_JELLYFIN_* is missing: seeding the mock instead. Start with `npm run start:jellyfin`.');
  }
  await connect(services, mockPlugin, kids.id);
}

// Literal reads inside a development-only branch: a production bundle drops
// them, and with them anything the variables held.
function serverFromEnvironment(): Server | undefined {
  if (!__DEV__) return undefined;
  const url = process.env.EXPO_PUBLIC_DEV_JELLYFIN_URL;
  const username = process.env.EXPO_PUBLIC_DEV_JELLYFIN_USERNAME;
  const password = process.env.EXPO_PUBLIC_DEV_JELLYFIN_PASSWORD;
  return url && username ? { url, username, password: password ?? '' } : undefined;
}

/**
 * One shared connection. A server's values go in by field type — its address,
 * its account, its password — so this never needs a plugin's field names.
 */
async function connect(services: Services, plugin: Plugin, tab: Parameters<typeof setValue>[2], server?: Server) {
  const { manifest } = plugin;
  await services.devicePlugins.setEnabled(manifest.id, true);
  let draft = initialDraft(manifest, 0);
  if (server) {
    const url = manifest.connectionFields.find((field) => field.type === 'url');
    const account = manifest.connectionFields.find((field) => field.type === 'text' && field.credential);
    const password = manifest.connectionFields.find((field) => field.type === 'password');
    if (url) draft = setValue(manifest, draft, tab, 'fields', url.key, server.url);
    if (account) draft = setValue(manifest, draft, tab, 'fields', account.key, server.username);
    if (password) draft = setSecret(draft, tab, password.key, server.password);
  }
  await services.connections.create(manifest.id, draft);
}
