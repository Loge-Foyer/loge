import { credentialsRef } from '@loge/api';

import type { Logger, SecureCredentialStore } from '@/services/ports';

export const DEVICE_KEY_REF = credentialsRef('device-key');

/**
 * This install's key, as media servers see it. It must not change between
 * launches, or a server counts a new device every time; and it must not travel
 * to another phone, or the two would end each other's sessions. So it lives in
 * the device-bound secure store, never in the database, which backups carry.
 *
 * The first time, it is derived from the platform's own identifier where
 * there is one — the key earlier versions used — and made up otherwise.
 */
export async function loadDeviceKey(deps: {
  readonly store: SecureCredentialStore;
  readonly platformId: () => Promise<string | null>;
  readonly derive: (platformId: string) => Promise<string>;
  readonly randomId: () => string;
  readonly log: Logger;
}): Promise<string> {
  const saved = await deps.store.read(DEVICE_KEY_REF).catch(() => undefined);
  if (saved?.deviceKey) return saved.deviceKey;
  const platformId = await deps.platformId().catch(() => null);
  const deviceKey = platformId ? await deps.derive(platformId) : deps.randomId();
  await deps.store.write(DEVICE_KEY_REF, { deviceKey }).catch((error: unknown) => {
    // Still usable for this launch; the next one tries to keep it again.
    deps.log.warn('storage', 'The device key could not be saved', { error: String(error) });
  });
  return deviceKey;
}
