// A pretend account that several devices in one test share, with the controls
// a test needs to make it misbehave the ways a real one can.
import {
  AppError,
  isSyncChange,
  pluginId,
  syncCursor,
  type ConnectedUserStateSyncProvider,
  type Plugin,
  type SyncCapability,
  type SyncChange,
} from '@sc/api';

import type { AppActivity, OwnerAnswer, OwnerAuthentication } from '@/services/ports';

export interface FakeAccount {
  readonly plugin: Plugin;
  /** Everything stored, in the account's order. */
  readonly log: readonly SyncChange[];
  readonly calls: { pushes: number; signIns: number; pulls: number };
  /** Store only the first `n` of the next push. */
  acceptOnly(n: number): void;
  /** The next call — of any kind — fails with this. */
  failNext(error: AppError): void;
  /** The next push is stored, and its answer lost on the way back. */
  loseNextAnswer(): void;
  /** Lose everything, as a wiped account would: every cursor answers `reset`. */
  reset(): void;
  /** Drop the last `n` changes, as an account restored from an older backup would: every cursor answers `reset`. */
  rewind(n: number): void;
  /** The next pull answers `expired`: the place in the log is gone, the data is not. */
  expireNext(): void;
  refuseOwner(refuse: boolean): void;
  /** Refuse every sign-in, as a changed password would. */
  refuseSignIn(refuse: boolean): void;
  /** Another device's change, landed before the change with id `before` — or last. */
  inject(change: SyncChange, before?: string): void;
  /** The same account, as a plugin declaring what it carries differently — an app update. */
  pluginCarrying(carries: readonly SyncCapability[]): Plugin;
}

export function fakeSyncAccount(
  options: {
    readonly id?: string;
    readonly pageSize?: number;
    readonly carries?: readonly SyncCapability[];
    /** A media role too, as iCloud or Google have — one that lists nothing. */
    readonly withMedia?: boolean;
    /** An account that cannot check its owner: the device is asked instead. */
    readonly noOwnerCheck?: boolean;
    /** A switch in its settings, on at first, that stops it carrying this. */
    readonly toggle?: SyncCapability;
  } = {},
): FakeAccount {
  const pageSize = options.pageSize ?? 50;
  let epoch = 1;
  const log: SyncChange[] = [];
  const stored = new Set<string>();
  const calls = { pushes: 0, signIns: 0, pulls: 0 };
  let acceptOnly: number | undefined;
  let failNext: AppError | undefined;
  let loseNext = false;
  let expireNext = false;
  let refuseOwner = false;
  let refuseSignIn = false;

  const check = () => {
    const failure = failNext;
    failNext = undefined;
    if (failure) throw failure;
    if (refuseSignIn) throw new AppError('UNAUTHORIZED', 'The account did not accept the sign-in.');
  };

  const provider = (connectionId: ConnectedUserStateSyncProvider['connectionId']): ConnectedUserStateSyncProvider => {
    const { verifyOwner, ...rest } = connected(connectionId);
    return options.noOwnerCheck ? rest : { ...rest, verifyOwner };
  };
  const connected = (connectionId: ConnectedUserStateSyncProvider['connectionId']) => ({
    connectionId,
    getStatus: async () => {
      calls.signIns += 1;
      check();
      return { accountName: 'The fake account' };
    },
    pull: async (cursor) => {
      calls.pulls += 1;
      check();
      if (expireNext) {
        expireNext = false;
        return { kind: 'expired' };
      }
      let from = 0;
      if (cursor !== undefined) {
        const [of, at] = cursor.split('.');
        if (Number(of) !== epoch || Number(at) > log.length) return { kind: 'reset' };
        from = Number(at);
      }
      const changes = log.slice(from, from + pageSize);
      const next = from + changes.length;
      return { kind: 'changes', changes, cursor: syncCursor(`${epoch}.${next}`), more: next < log.length };
    },
    push: async (changes) => {
      calls.pushes += 1;
      check();
      const limit = acceptOnly ?? changes.length;
      acceptOnly = undefined;
      const accepted: string[] = [];
      for (const change of changes.slice(0, limit)) {
        if (!isSyncChange(change)) break;
        if (!stored.has(change.id)) {
          stored.add(change.id);
          log.push(JSON.parse(JSON.stringify(change)) as SyncChange);
        }
        accepted.push(change.id);
      }
      if (loseNext) {
        loseNext = false;
        throw new AppError('TIMEOUT', 'The answer never came back.', { retry: 'backoff' });
      }
      return { accepted };
    },
    verifyOwner: async () => {
      const failure = failNext;
      failNext = undefined;
      if (failure) throw failure;
      if (refuseOwner) throw new AppError('UNAUTHORIZED', 'That is not the owner.');
    },
    dispose: async () => undefined,
  }) satisfies Required<ConnectedUserStateSyncProvider>;

  const pluginCarrying = (carries: readonly SyncCapability[]): Plugin => ({
    manifest: {
      id: pluginId(options.id ?? 'fake-account'),
      displayName: 'Fake account',
      description: 'An account that exists only in tests.',
      sync: { capabilities: [...carries] },
      ...(options.withMedia ? { media: { contentKinds: ['files' as const], capabilities: [] } } : {}),
      connectionFields: [{ key: 'server', label: 'Server', type: 'url' }],
      settings: options.toggle
        ? [{ key: 'carry', label: `Carry ${options.toggle}`, type: 'boolean', default: true, gates: [`sync.${options.toggle}`] }]
        : [],
    },
    sync: { connect: async (target) => provider(target.connectionId) },
  });

  return {
    plugin: pluginCarrying(options.carries ?? ['profile', 'preferences', 'providerConnections']),
    pluginCarrying,
    inject: (change, before) => {
      stored.add(change.id);
      const at = before === undefined ? -1 : log.findIndex((candidate) => candidate.id === before);
      if (at < 0) log.push(change);
      else log.splice(at, 0, change);
    },
    log,
    calls,
    acceptOnly: (n) => {
      acceptOnly = n;
    },
    failNext: (error) => {
      failNext = error;
    },
    loseNextAnswer: () => {
      loseNext = true;
    },
    reset: () => {
      epoch += 1;
      log.length = 0;
      stored.clear();
    },
    rewind: (n) => {
      epoch += 1;
      for (const change of log.splice(log.length - n, n)) stored.delete(change.id);
    },
    expireNext: () => {
      expireNext = true;
    },
    refuseOwner: (refuse) => {
      refuseOwner = refuse;
    },
    refuseSignIn: (refuse) => {
      refuseSignIn = refuse;
    },
  };
}

/** Face ID, as a test decides it goes. */
export function fakeOwnerAuthentication(initial: { available: boolean; answer?: OwnerAnswer }): OwnerAuthentication & {
  set(next: { available: boolean; answer?: OwnerAnswer }): void;
  readonly asked: string[];
} {
  let state = initial;
  const asked: string[] = [];
  return {
    asked,
    available: async () => state.available,
    authenticate: async (reason) => {
      asked.push(reason);
      return state.available ? (state.answer ?? 'verified') : 'unavailable';
    },
    set: (next) => {
      state = next;
    },
  };
}

export function fakeActivity(initial = true): AppActivity & { set(active: boolean): void } {
  let active = initial;
  const listeners = new Set<(active: boolean) => void>();
  return {
    active: () => active,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      active = next;
      for (const listener of listeners) listener(next);
    },
  };
}
