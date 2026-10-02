// Devices on one account: a service graph and a database each, one fake server between them.
import { userId, type Plugin, type UserId } from '@loge/api';

import type { PreparedAccount, ServerTarget } from '@/services/account';
import { initialDraft, setSecret, setValue } from '@/services/connection-draft';
import type { ConnectionDraft } from '@/services/connections';

import { reopenable, type Engine } from './engines';
import { buildServices, fakeMediaPlugin, movie, type FakeSourceOptions } from './services';
import { ACCOUNT_PASSWORD, fakeAccountServer, type FakeServer, type FakeServerOptions } from './sync';

export type Device = ReturnType<typeof buildServices> & { readonly where: ReturnType<typeof reopenable> };

export const ENGINE_PAIRS: readonly (readonly [Engine, Engine])[] = [
  ['sqlite', 'sqlite'],
  ['indexeddb', 'indexeddb'],
  ['sqlite', 'indexeddb'],
];

// A draft's tab only matters when a connection keeps values per profile; the account's never does.
const ANY_TAB = userId('any');

export function twoDevices(
  engines: readonly [Engine, Engine],
  options: { readonly extra?: readonly Plugin[]; readonly server?: FakeServerOptions; readonly media?: FakeSourceOptions } = {},
) {
  const server = fakeAccountServer(options.server);
  const media = fakeMediaPlugin('fake', { movies: (id) => [movie(id, 'm1', 2020)], signsIn: true, ...options.media });
  const plugins = [server.plugin, media.plugin, ...(options.extra ?? [])];
  const device = (name: string, engine: Engine): Device => {
    const where = reopenable(engine);
    return { ...buildServices({ plugins, engine, device: name, where }), where };
  };
  return { server, media, plugins, a: device('a', engines[0]), b: device('b', engines[1]) };
}

/** The sign-in form, filled in for an account on the fake server. */
export function serverDraft(server: FakeServer, username = 'sam', password = ACCOUNT_PASSWORD): ConnectionDraft {
  const { manifest } = server.plugin;
  let draft = initialDraft(manifest, 0);
  draft = setValue(manifest, draft, ANY_TAB, 'fields', 'serverUrl', 'https://home.example');
  draft = setValue(manifest, draft, ANY_TAB, 'fields', 'username', username);
  return setSecret(draft, ANY_TAB, 'password', password);
}

/** Where "Sign in" goes for this account. */
export function target(server: FakeServer, options: { readonly username?: string; readonly password?: string; readonly signUp?: string } = {}): ServerTarget {
  return {
    pluginId: server.plugin.manifest.id,
    draft: serverDraft(server, options.username, options.password),
    ...(options.signUp === undefined ? {} : { signUp: { invite: options.signUp } }),
  };
}

/** Signing in again, with the password typed anew. */
export function againTarget(server: FakeServer, password = ACCOUNT_PASSWORD): ServerTarget {
  return { pluginId: server.plugin.manifest.id, draft: setSecret(initialDraft(server.plugin.manifest, 0), ANY_TAB, 'password', password), again: true };
}

/** Signs a device in — or signs up, with an invite — and saves what it found. */
export async function signIn(
  device: Pick<Device, 'services'>,
  server: FakeServer,
  options: { readonly username?: string; readonly password?: string; readonly signUp?: string; readonly proof?: string } = {},
): Promise<PreparedAccount & { readonly profilesArrived: number }> {
  const prepared = await device.services.account.prepare(target(server, options), options.proof === undefined ? undefined : { password: options.proof });
  return { ...prepared, ...(await device.services.account.complete(prepared)) };
}

/** One full run: what this device has goes up, what the account has comes down. */
export const sync = (device: Pick<Device, 'engine'>) => device.engine.run();

/** A device of its own on the account: a first profile made locally, then signed up with the invite. */
export async function withAccount(device: Device, server: FakeServer, names: readonly string[], invite: string) {
  const ids: UserId[] = [];
  for (const name of names) ids.push((await device.services.profiles.create(name)).id);
  await signIn(device, server, { signUp: invite });
  await sync(device);
  return ids;
}

/** A media connection with a saved password, shared by every profile. */
export function mediaDraft(media: ReturnType<typeof fakeMediaPlugin>, tab: UserId, password = 'family-secret'): ConnectionDraft {
  let draft = initialDraft(media.manifest, 0);
  draft = setValue(media.manifest, draft, tab, 'fields', 'serverUrl', 'http://home:8096');
  draft = setValue(media.manifest, draft, tab, 'fields', 'username', 'family');
  return setSecret(draft, tab, 'password', password);
}
