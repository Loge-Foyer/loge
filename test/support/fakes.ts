// The device boundary, faked: ids, clock, network, logging and the keychain.
// Everything else in the tests is the real implementation.
import type { Credentials, CredentialsRef, NetworkKind } from '@loge/api';

import type { Clock, Logger, NetworkMonitor, SecureCredentialStore } from '@/services/ports';

/** Ids from a counter. Two devices in one test take different prefixes, so they never mint the same id. */
export function counterIds(prefix = 'id-') {
  let next = 0;
  return { next: () => `${prefix}${(next += 1)}` };
}

export function fakeClock(start = 1_000_000): Clock & { advance(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

export function fakeNetwork(initial: NetworkKind = 'wifi'): NetworkMonitor & { set(kind: NetworkKind): void } {
  let current = initial;
  const listeners = new Set<(kind: NetworkKind, previous: NetworkKind) => void>();
  return {
    current: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (kind) => {
      if (kind === current) return;
      const previous = current;
      current = kind;
      for (const listener of listeners) listener(kind, previous);
    },
  };
}

export const silentLog: Logger = { debug: () => undefined, warn: () => undefined, error: () => undefined };

/**
 * The credential store, as a keychain in memory. Every call settles on a
 * later macrotask, as a real keychain or WebCrypto call does — so a service
 * that awaits one inside an IndexedDB transaction fails its test, just as it
 * would fail in a browser.
 */
export function memoryCredentialStore(): SecureCredentialStore & { readonly entries: ReadonlyMap<CredentialsRef, Credentials> } {
  const entries = new Map<CredentialsRef, Credentials>();
  const later = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    entries,
    read: async (ref) => {
      await later();
      const value = entries.get(ref);
      return value && { ...value };
    },
    write: async (ref, credentials) => {
      await later();
      entries.set(ref, { ...credentials });
    },
    delete: async (ref) => {
      await later();
      entries.delete(ref);
    },
  };
}
