// A pretend account that several devices in one test share, with the controls
// a test needs to make it misbehave the ways a real one can. It keeps a session
// in each device's context, as a real account plugin does: a device signs in
// only when it has none, and never signs itself back in once let go.
import {
  AppError,
  isSyncChange,
  pluginId,
  syncCursor,
  type ConnectedUserStateSyncProvider,
  type Field,
  type Plugin,
  type PluginContext,
  type SyncCapability,
  type SyncChange,
} from '@sc/api';

import type { AppActivity, OwnerAnswer, OwnerAuthentication } from '@/services/ports';

export interface FakeAccount {
  readonly plugin: Plugin;
  /** The vault key every device signed in to it seals with. */
  readonly vaultKey: Uint8Array;
  /** Everything stored, in the account's order. */
  readonly log: readonly SyncChange[];
  readonly calls: { pushes: number; signIns: number; pulls: number; signOuts: number; vaultKeys: number; owners: number; creates: number };
  /** Store only the first `n` of the next push. */
  acceptOnly(n: number): void;
  /** The next call — of any kind — fails with this. */
  failNext(error: AppError): void;
  /** The next pull fails with this: what comes after a sign-in, not the sign-in itself. */
  failNextPull(error: AppError): void;
  /** The next push is stored, and its answer lost on the way back. */
  loseNextAnswer(): void;
  /** Lose everything, as a wiped account would: every cursor answers `reset`. */
  reset(): void;
  /** Drop the last `n` changes, as an account restored from an older backup would: every cursor answers `reset`. */
  rewind(n: number): void;
  /** The next pull answers `expired`: the place in the log is gone, the data is not. */
  expireNext(): void;
  refuseOwner(refuse: boolean): void;
  /** Answer the owner check as throttled: too many wrong tries. */
  throttleOwner(throttle: boolean): void;
  /** Refuse every sign-in and every session, as a password changed elsewhere would. */
  refuseSignIn(refuse: boolean): void;
  /** Let every device go, as `sc-sync revoke` does: each is signed out, and signs in only when its user does. */
  revoke(): void;
  /** Fail every ask for the vault key with this, until `undefined`. */
  failVaultKey(error: AppError | undefined): void;
  /** Another device's change, landed before the change with id `before` — or last. */
  inject(change: SyncChange, before?: string): void;
  /** The same account, as a plugin declaring what it carries differently — an app update. */
  pluginCarrying(carries: readonly SyncCapability[]): Plugin;
}

export interface FakeAccountOptions {
  readonly id?: string;
  readonly pageSize?: number;
  readonly carries?: readonly SyncCapability[];
  /** A media role too, as iCloud or Google have — one that lists nothing. */
  readonly withMedia?: boolean;
  /** An account that cannot check its owner: the device is asked instead. */
  readonly noOwnerCheck?: boolean;
  /** A switch in its settings, on at first, that stops it carrying this. */
  readonly toggle?: SyncCapability;
  /** The account password its owner check asks for again (`ownerProof`), as your own server's does. */
  readonly ownerPassword?: string;
  /** Accounts are created from the app with this invite (`signUp`). */
  readonly invite?: string;
}

/** What a sealing account carries: everything the fake does, passwords included. */
export const SEALING: readonly SyncCapability[] = ['profile', 'preferences', 'providerConnections', 'sealedPasswords'];

const SIGNED_OUT = 'signed-out';

export function fakeSyncAccount(options: FakeAccountOptions = {}): FakeAccount {
  const pageSize = options.pageSize ?? 50;
  let epoch = 1;
  const log: SyncChange[] = [];
  const stored = new Set<string>();
  const calls = { pushes: 0, signIns: 0, pulls: 0, signOuts: 0, vaultKeys: 0, owners: 0, creates: 0 };
  // One account, one vault: every device signed in to it seals with the same key.
  const vault = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const tokens = new Set<string>();
  let issued = 0;
  let acceptOnly: number | undefined;
  let failNext: AppError | undefined;
  let failPull: AppError | undefined;
  let loseNext = false;
  let expireNext = false;
  let refuseOwner = false;
  let throttleOwner = false;
  let refuseSignIn = false;
  let failVaultKey: AppError | undefined;

  const failure = () => {
    const next = failNext;
    failNext = undefined;
    if (next) throw next;
  };
  const signedOut = () => new AppError('UNAUTHORIZED', 'The account no longer knows this device.', { reason: 'signed-out' });
  const refused = () => new AppError('UNAUTHORIZED', 'The account did not accept the sign-in.');
  const newSession = async (context: PluginContext) => {
    issued += 1;
    const token = `token-${issued}`;
    tokens.add(token);
    await context.session.write(token);
    return token;
  };

  const connected = (connectionId: ConnectedUserStateSyncProvider['connectionId'], context: PluginContext) => {
    // What a call runs with: this device's session, signing in when there is none — never after being let go.
    const session = async () => {
      failure();
      const token = await context.session.read();
      if (token === SIGNED_OUT) throw signedOut();
      if (token !== undefined) {
        if (tokens.has(token)) return token;
        await context.session.write(SIGNED_OUT);
        throw refuseSignIn ? refused() : signedOut();
      }
      calls.signIns += 1;
      if (refuseSignIn) throw refused();
      return newSession(context);
    };
    return {
      connectionId,
      getStatus: async () => {
        await session();
        return { accountName: 'The fake account' };
      },
      pull: async (cursor) => {
        calls.pulls += 1;
        await session();
        const pullFailure = failPull;
        failPull = undefined;
        if (pullFailure) throw pullFailure;
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
        await session();
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
      verifyOwner: async (proof) => {
        calls.owners += 1;
        await session();
        if (throttleOwner) throw new AppError('UNAUTHORIZED', 'Too many tries.', { reason: 'too-many-attempts' });
        const wrong = options.ownerPassword !== undefined && proof.password !== options.ownerPassword;
        if (refuseOwner || wrong) throw new AppError('UNAUTHORIZED', 'That is not the owner.');
      },
      vaultKey: async () => {
        calls.vaultKeys += 1;
        await session();
        if (failVaultKey) throw failVaultKey;
        return vault;
      },
      createAccount: async (fields) => {
        calls.creates += 1;
        failure();
        if (fields.invite !== options.invite) throw new AppError('INVALID_STATE', 'That invite code is used, expired or unknown.');
        await newSession(context);
        return { accountName: 'The fake account' };
      },
      signOut: async () => {
        calls.signOuts += 1;
        const token = await context.session.read();
        if (token === undefined || token === SIGNED_OUT) return;
        tokens.delete(token);
        await context.session.write(SIGNED_OUT);
      },
      dispose: async () => undefined,
    } satisfies Required<ConnectedUserStateSyncProvider>;
  };

  const provider = (connectionId: ConnectedUserStateSyncProvider['connectionId'], context: PluginContext): ConnectedUserStateSyncProvider => {
    const { verifyOwner, createAccount, ...rest } = connected(connectionId, context);
    return {
      ...rest,
      ...(options.noOwnerCheck ? {} : { verifyOwner }),
      ...(options.invite === undefined ? {} : { createAccount }),
    };
  };

  const inviteField: Field = { key: 'invite', label: 'Invite code', type: 'text', required: true };
  const pluginCarrying = (carries: readonly SyncCapability[]): Plugin => ({
    manifest: {
      id: pluginId(options.id ?? 'fake-account'),
      displayName: 'Fake account',
      description: 'An account that exists only in tests.',
      sync: {
        capabilities: [...carries],
        ...(options.ownerPassword === undefined ? {} : { ownerProof: { fields: ['password'] } }),
        ...(options.invite === undefined ? {} : { signUp: { fields: [inviteField] } }),
      },
      ...(options.withMedia ? { media: { contentKinds: ['files' as const], capabilities: [] } } : {}),
      connectionFields: [
        { key: 'server', label: 'Server', type: 'url' },
        ...(options.ownerPassword === undefined ? [] : [{ key: 'password', label: 'Password', type: 'password' } as const]),
      ],
      settings: options.toggle
        ? [{ key: 'carry', label: `Carry ${options.toggle}`, type: 'boolean', default: true, gates: [`sync.${options.toggle}`] }]
        : [],
    },
    sync: { connect: async (target, context) => provider(target.connectionId, context) },
  });

  return {
    plugin: pluginCarrying(options.carries ?? ['profile', 'preferences', 'providerConnections']),
    vaultKey: vault,
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
    failNextPull: (error) => {
      failPull = error;
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
    throttleOwner: (throttle) => {
      throttleOwner = throttle;
    },
    refuseSignIn: (refuse) => {
      refuseSignIn = refuse;
      // A changed password: the sessions made with the old one go too.
      if (refuse) tokens.clear();
    },
    revoke: () => tokens.clear(),
    failVaultKey: (error) => {
      failVaultKey = error;
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
