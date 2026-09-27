import { describe, expect, it } from 'vitest';

import { DEVICE_KEY_REF, loadDeviceKey } from '@/platform/device-key';
import type { SecureCredentialStore } from '@/services/ports';

import { memoryCredentialStore, silentLog } from './support/fakes';

const deps = (store: SecureCredentialStore, platformId: string | null = 'IDFV-1') => ({
  store,
  platformId: async () => platformId,
  derive: async (id: string) => `hash(${id})`,
  randomId: () => 'random-1',
  log: silentLog,
});

describe('the device key', () => {
  it('is derived from the platform’s identifier the first time, and kept', async () => {
    const store = memoryCredentialStore();
    expect(await loadDeviceKey(deps(store))).toBe('hash(IDFV-1)');
    expect(await store.read(DEVICE_KEY_REF)).toEqual({ deviceKey: 'hash(IDFV-1)' });
  });

  it('stays the same once kept, whatever the platform says later', async () => {
    const store = memoryCredentialStore();
    await loadDeviceKey(deps(store));
    expect(await loadDeviceKey(deps(store, 'IDFV-2'))).toBe('hash(IDFV-1)');
    expect(await loadDeviceKey(deps(store, null))).toBe('hash(IDFV-1)');
  });

  it('is made up where the platform has no identifier, as on the web', async () => {
    const store = memoryCredentialStore();
    expect(await loadDeviceKey(deps(store, null))).toBe('random-1');
    expect(await loadDeviceKey({ ...deps(store, null), randomId: () => 'random-2' })).toBe('random-1');
  });

  it('still gives a key when the store cannot be used', async () => {
    const broken: SecureCredentialStore = {
      read: async () => {
        throw new Error('Locked before first unlock');
      },
      write: async () => {
        throw new Error('Locked before first unlock');
      },
      delete: async () => undefined,
    };
    expect(await loadDeviceKey(deps(broken))).toBe('hash(IDFV-1)');
  });
});
