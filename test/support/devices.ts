// Two devices on one account: two service graphs, two databases, one fake account.
import type { Plugin, UserId } from '@sc/api';

import { initialDraft, setSecret, setValue } from '@/services/connection-draft';
import type { ConnectionDraft } from '@/services/connections';

import { reopenable, type Engine } from './engines';
import { buildServices, fakeMediaPlugin, movie } from './services';
import { fakeSyncAccount, type FakeAccount } from './sync';

export type Device = ReturnType<typeof buildServices> & { readonly where: ReturnType<typeof reopenable> };

export const ENGINE_PAIRS: readonly (readonly [Engine, Engine])[] = [
  ['sqlite', 'sqlite'],
  ['indexeddb', 'indexeddb'],
  ['sqlite', 'indexeddb'],
];

export function twoDevices(engines: readonly [Engine, Engine], extra: readonly Plugin[] = []) {
  const account = fakeSyncAccount();
  const media = fakeMediaPlugin('fake', { movies: (id) => [movie(id, 'm1', 2020)], signsIn: true });
  const plugins = [account.plugin, media.plugin, ...extra];
  const device = (name: string, engine: Engine): Device => {
    const where = reopenable(engine);
    return { ...buildServices({ plugins, engine, device: name, where }), where };
  };
  return { account, media, plugins, a: device('a', engines[0]), b: device('b', engines[1]) };
}

/** The sign-in form, filled in for the fake account. */
export function accountDraft(account: FakeAccount): ConnectionDraft {
  return initialDraft(account.plugin.manifest, 0);
}

/** Signs a device in, answering "profiles on both sides?" with `profiles` if it is asked. */
export async function signIn(device: Pick<Device, 'services'>, account: FakeAccount, profiles: 'account' | 'both' = 'both') {
  const prepared = await device.services.account.prepareSignIn({ pluginId: account.plugin.manifest.id, draft: accountDraft(account) });
  return { prepared, ...(await device.services.account.completeSignIn(prepared, profiles)) };
}

/** One full run: what the account has comes down, what this device has goes up. */
export const sync = (device: Pick<Device, 'engine'>) => device.engine.run();

/** A media connection with a saved password, shared by every profile. */
export function mediaDraft(media: ReturnType<typeof fakeMediaPlugin>, tab: UserId, password = 'family-secret'): ConnectionDraft {
  let draft = initialDraft(media.manifest, 0);
  draft = setValue(media.manifest, draft, tab, 'fields', 'serverUrl', 'http://home:8096');
  draft = setValue(media.manifest, draft, tab, 'fields', 'username', 'family');
  return setSecret(draft, tab, 'password', password);
}

