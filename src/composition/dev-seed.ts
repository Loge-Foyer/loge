import { defaultRoles } from '@sc/api';

import type { Services } from '@/services';
import { defaultValues } from '@/services/field-values';

import { mockPlugin } from './plugins';

/** `EXPO_PUBLIC_DEV_SEED`: `1` opens as Kids; `locked` opens on Alex's PIN pad. */
export type DevSeed = 'open' | 'locked';

export function devSeedFrom(value: string | undefined): DevSeed | null {
  if (value === '1') return 'open';
  if (value === 'locked') return 'locked';
  return null;
}

/**
 * Storage is in memory for now, so every reload is a first launch. A seeded
 * development build starts past it: two profiles — Kids, and Alex with PIN
 * 1234 — and the mock plugin installed with one shared connection. Which of
 * them is the device default decides the boot branch you land on.
 */
export async function seedDevelopmentData(services: Services, seed: DevSeed): Promise<void> {
  const kids = await services.profiles.create('Kids');
  const alex = await services.profiles.create('Alex');
  await services.pins.create(alex.id, '1234');
  await services.profiles.setDefault(seed === 'locked' ? alex.id : kids.id);

  const { manifest } = mockPlugin;
  await services.devicePlugins.setEnabled(manifest.id, true);
  await services.connections.create(
    manifest.id,
    { scope: 'device' },
    {
      label: 'Mock library',
      roles: defaultRoles(manifest),
      fields: defaultValues(manifest.connectionFields),
      secrets: {},
      settings: defaultValues(manifest.settings),
    },
  );
}
