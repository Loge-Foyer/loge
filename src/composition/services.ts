import { createConnectionService } from '@/services/connections';
import { createDevicePlugins } from '@/services/device-plugins';
import type { Services } from '@/services';
import { createPinService } from '@/services/pins';
import { createPluginCatalog } from '@/services/plugin-catalog';
import { createProfileService } from '@/services/profiles';
import { createSessionService } from '@/services/session';
import { createSourceService } from '@/services/sources';
import { createMemoryStores } from '@/persistence/memory';
import { systemClock } from '@/platform/clock';
import { createMemoryCredentialStore } from '@/platform/credential-store';
import { uuidGenerator } from '@/platform/ids';

import { plugins } from './plugins';

/** Builds the whole service graph. The only place concrete implementations are chosen. */
export function createServices(): Services {
  const stores = createMemoryStores();
  const credentials = createMemoryCredentialStore();
  const ids = uuidGenerator;

  const catalog = createPluginCatalog(plugins, { strict: __DEV__, warn: console.warn });
  const devicePlugins = createDevicePlugins(stores.deviceSettings);
  const pins = createPinService({ users: stores.users, credentials, ids, clock: systemClock });
  const session = createSessionService({
    users: stores.users,
    deviceSettings: stores.deviceSettings,
    pins,
  });
  const profiles = createProfileService({
    users: stores.users,
    connections: stores.connections,
    credentials,
    deviceSettings: stores.deviceSettings,
    session,
    ids,
  });
  const connections = createConnectionService({
    connections: stores.connections,
    credentials,
    catalog,
    devicePlugins,
    ids,
  });
  const sources = createSourceService({ catalog, devicePlugins, connections: stores.connections });

  return { catalog, devicePlugins, session, profiles, pins, connections, sources };
}
