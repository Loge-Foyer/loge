import type { Credentials, CredentialsRef } from '@sc/api';

import type { Logger, SecureCredentialStore } from '@/services/ports';

/** What the browser provides, passed in so the tests can run it on Node's WebCrypto and an in-memory IndexedDB. */
export interface WebSecretsEnvironment {
  readonly indexedDB: IDBFactory;
  readonly crypto: Pick<Crypto, 'subtle' | 'getRandomValues'>;
}

interface SealedSecret {
  readonly ref: CredentialsRef;
  readonly iv: Uint8Array<ArrayBuffer>;
  readonly data: ArrayBuffer;
}

const KEY_ID = 'secrets';

function request<T>(pending: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error);
  });
}

/** One request in a transaction of its own — this store never needs more. */
async function once<T>(db: IDBDatabase, store: 'keys' | 'secrets', mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>) {
  const tx = db.transaction(store, mode);
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  const [result] = await Promise.all([request(make(tx.objectStore(store))), committed]);
  return result;
}

/**
 * The web's stand-in for a keychain: AES-GCM ciphertext in its own IndexedDB
 * database, under a key the page can use but never read. That is weaker than
 * a keychain — any script running on the page can use the key — which is why
 * the page needs a strict Content-Security-Policy. Encryption happens before
 * a transaction opens: IndexedDB would commit one that waited on WebCrypto.
 */
export function createWebCredentialStore(
  env: WebSecretsEnvironment,
  options: { readonly name?: string; readonly log?: Logger } = {},
): SecureCredentialStore {
  const encoder = new TextEncoder();
  let opened: Promise<IDBDatabase> | undefined;
  let key: Promise<CryptoKey> | undefined;

  const database = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const opening = env.indexedDB.open(options.name ?? 'streaming-center-secrets', 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore('keys', { keyPath: 'id' });
        opening.result.createObjectStore('secrets', { keyPath: 'ref' });
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    }).catch((error: unknown) => {
      opened = undefined;
      throw error;
    }));

  const readKey = async (db: IDBDatabase) =>
    (await once(db, 'keys', 'readonly', (store) => store.get(KEY_ID) as IDBRequest<{ key: CryptoKey } | undefined>))?.key;

  // Created once, and never extractable. Two tabs creating it at once: the
  // second `add` fails, and both use the key that was stored first.
  const secretKey = () =>
    (key ??= (async () => {
      const db = await database();
      const stored = await readKey(db);
      if (stored) return stored;
      const created = await env.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      try {
        await once(db, 'keys', 'readwrite', (store) => store.add({ id: KEY_ID, key: created }));
        return created;
      } catch {
        const winner = await readKey(db);
        if (!winner) throw new Error('The key for saved secrets could not be stored.');
        return winner;
      }
    })().catch((error: unknown) => {
      key = undefined;
      throw error;
    }));

  return {
    read: async (ref) => {
      const db = await database();
      const sealed = await once(db, 'secrets', 'readonly', (store) => store.get(ref) as IDBRequest<SealedSecret | undefined>);
      if (!sealed) return undefined;
      try {
        const plain = await env.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: sealed.iv, additionalData: encoder.encode(ref) },
          await secretKey(),
          sealed.data,
        );
        return JSON.parse(new TextDecoder().decode(plain)) as Credentials;
      } catch {
        // Sealed under a key this browser no longer has, or for another ref: as good as gone.
        options.log?.warn('storage', 'A saved secret could not be decrypted');
        return undefined;
      }
    },
    write: async (ref, credentials) => {
      const iv = env.crypto.getRandomValues(new Uint8Array(12));
      // The ref is authenticated with the value, so a value moved under another ref fails to decrypt.
      const data = await env.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(ref) },
        await secretKey(),
        encoder.encode(JSON.stringify(credentials)),
      );
      await once(await database(), 'secrets', 'readwrite', (store) => store.put({ ref, iv, data } satisfies SealedSecret));
    },
    delete: async (ref) => {
      await once(await database(), 'secrets', 'readwrite', (store) => store.delete(ref));
    },
  };
}
