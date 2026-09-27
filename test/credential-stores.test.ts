import { credentialsRef } from '@sc/api';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { createKeychainCredentialStore, keychainKey, type Keychain } from '@/platform/keychain-credentials';
import { createWebCredentialStore } from '@/platform/web-credentials';

import { silentLog } from './support/fakes';

/** A keychain that holds entries per service and refuses keys the way expo-secure-store does. */
function fakeKeychain() {
  const entries = new Map<string, string>();
  const calls: { key: string; service?: string; accessible?: number }[] = [];
  const at = (key: string, options?: { keychainService?: string; keychainAccessible?: number }) => {
    if (!/^[\w.-]+$/.test(key)) throw new Error(`Invalid key provided to SecureStore: ${key}`);
    calls.push({ key, ...(options?.keychainService ? { service: options.keychainService } : {}), ...(options?.keychainAccessible === undefined ? {} : { accessible: options.keychainAccessible }) });
    return `${options?.keychainService ?? 'app'}|${key}`;
  };
  const keychain: Keychain = {
    getItemAsync: async (key, options) => entries.get(at(key, options)) ?? null,
    setItemAsync: async (key, value, options) => {
      entries.set(at(key, options), value);
    },
    deleteItemAsync: async (key, options) => {
      entries.delete(at(key, options));
    },
  };
  return { keychain, entries, calls };
}

describe('the keychain credential store', () => {
  it('keeps a secret under any ref, including a session ref that SecureStore could not take as a key', async () => {
    const { keychain } = fakeKeychain();
    const store = createKeychainCredentialStore(keychain, { service: 'sc.device', accessible: 7 });
    const ref = credentialsRef('session:3f2a-connection:shared');
    await store.write(ref, { value: 'token', identity: '{}' });
    expect(await store.read(ref)).toEqual({ value: 'token', identity: '{}' });
    await store.delete(ref);
    expect(await store.read(ref)).toBeUndefined();
  });

  it('never gives two refs the same key', () => {
    const refs = ['a:b', 'a_00003ab', 'a.b', 'a-b', 'a b', 'a:b:', 'ä', '😀', 'a\u0000'].map(credentialsRef);
    const keys = refs.map(keychainKey);
    expect(new Set(keys).size).toBe(refs.length);
    for (const key of keys) expect(key).toMatch(/^[\w.-]+$/);
  });

  it('reads, writes and deletes in its own service with its own accessibility', async () => {
    const { keychain, calls } = fakeKeychain();
    const passwords = createKeychainCredentialStore(keychain, { service: 'sc.credentials', accessible: 1 });
    const tokens = createKeychainCredentialStore(keychain, { service: 'sc.device', accessible: 2 });
    const ref = credentialsRef('same-ref');
    await passwords.write(ref, { password: 'hunter2' });
    await tokens.write(ref, { value: 'token' });
    expect(await passwords.read(ref)).toEqual({ password: 'hunter2' });
    expect(await tokens.read(ref)).toEqual({ value: 'token' });
    expect(new Set(calls.map((call) => `${call.service}/${call.accessible}`))).toEqual(new Set(['sc.credentials/1', 'sc.device/2']));
  });

  it('reads a value the keychain cannot give back as missing', async () => {
    const { keychain } = fakeKeychain();
    const failing: Keychain = { ...keychain, getItemAsync: async () => { throw new Error('Keystore key invalidated'); } };
    const store = createKeychainCredentialStore(failing, { service: 'sc.credentials', accessible: 1, log: silentLog });
    expect(await store.read(credentialsRef('pin-ref'))).toBeUndefined();
  });

  it('reads a value it cannot parse as missing', async () => {
    const { keychain, entries } = fakeKeychain();
    const store = createKeychainCredentialStore(keychain, { service: 'sc.credentials', accessible: 1 });
    const ref = credentialsRef('broken');
    entries.set(`sc.credentials|${keychainKey(ref)}`, 'not json');
    expect(await store.read(ref)).toBeUndefined();
  });
});

describe('the web credential store', () => {
  const open = (indexedDB: IDBFactory) => createWebCredentialStore({ indexedDB, crypto: globalThis.crypto }, { log: silentLog });

  /** Every record as IndexedDB holds it, read without the store. */
  function rawRecords(indexedDB: IDBFactory, storeName: 'keys' | 'secrets') {
    return new Promise<unknown[]>((resolve, reject) => {
      const opening = indexedDB.open('streaming-center-secrets');
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const all = opening.result.transaction(storeName).objectStore(storeName).getAll();
        all.onsuccess = () => {
          opening.result.close();
          resolve(all.result);
        };
        all.onerror = () => reject(all.error);
      };
    });
  }

  it('keeps a secret, and forgets it when asked', async () => {
    const store = open(new IDBFactory());
    const ref = credentialsRef('ref-1');
    await store.write(ref, { password: 'hunter2' });
    expect(await store.read(ref)).toEqual({ password: 'hunter2' });
    await store.delete(ref);
    expect(await store.read(ref)).toBeUndefined();
    expect(await store.read(credentialsRef('never-written'))).toBeUndefined();
  });

  it('stores only ciphertext, under a key that cannot be read out', async () => {
    const indexedDB = new IDBFactory();
    await open(indexedDB).write(credentialsRef('ref-1'), { password: 'hunter2' });
    const [sealed] = (await rawRecords(indexedDB, 'secrets')) as { data: ArrayBuffer }[];
    expect(new TextDecoder().decode(sealed?.data)).not.toContain('hunter2');
    const [stored] = (await rawRecords(indexedDB, 'keys')) as { key: CryptoKey }[];
    expect(stored?.key.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey('raw', stored!.key)).rejects.toThrow();
  });

  it('refuses a value moved under another ref', async () => {
    const indexedDB = new IDBFactory();
    const store = open(indexedDB);
    await store.write(credentialsRef('mine'), { password: 'hunter2' });
    const [sealed] = (await rawRecords(indexedDB, 'secrets')) as { iv: Uint8Array; data: ArrayBuffer }[];
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open('streaming-center-secrets');
      opening.onsuccess = () => {
        const tx = opening.result.transaction('secrets', 'readwrite');
        tx.objectStore('secrets').put({ ...sealed, ref: 'theirs' });
        tx.oncomplete = () => {
          opening.result.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
    });
    expect(await store.read(credentialsRef('theirs'))).toBeUndefined();
    expect(await store.read(credentialsRef('mine'))).toEqual({ password: 'hunter2' });
  });

  it('agrees on one key across tabs, even when both create it at once', async () => {
    const indexedDB = new IDBFactory();
    const first = open(indexedDB);
    const second = open(indexedDB);
    await Promise.all([first.write(credentialsRef('a'), { password: 'one' }), second.write(credentialsRef('b'), { password: 'two' })]);
    expect(await first.read(credentialsRef('b'))).toEqual({ password: 'two' });
    expect(await second.read(credentialsRef('a'))).toEqual({ password: 'one' });
    expect(await rawRecords(indexedDB, 'keys')).toHaveLength(1);
  });

  it('reads a secret sealed under a lost key as missing', async () => {
    const indexedDB = new IDBFactory();
    await open(indexedDB).write(credentialsRef('ref-1'), { password: 'hunter2' });
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open('streaming-center-secrets');
      opening.onsuccess = () => {
        const tx = opening.result.transaction('keys', 'readwrite');
        tx.objectStore('keys').clear();
        tx.oncomplete = () => {
          opening.result.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
    });
    expect(await open(indexedDB).read(credentialsRef('ref-1'))).toBeUndefined();
  });
});
