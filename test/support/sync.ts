// A pretend server that several devices in one test share, keeping the rules
// your own server keeps: accounts by username, every record of an account by
// kind and key, batches stored all or nothing, the profile limit, a deleted
// profile or connection deleted for good, tombstones emptied, and a password a
// write lists without its value kept. Each device keeps its session in its
// own context, as the real plugin does: with none, or when it ended, it signs
// in once with the saved password, and latches a refusal.
import {
  AppError,
  DEFAULT_MAX_PROFILES,
  isAccountRecord,
  pluginId,
  type AccountRecord,
  type AccountStatus,
  type ConnectedAccount,
  type Credentials,
  type Field,
  type Plugin,
  type PluginContext,
  type PushOutcome,
  type PushRefusal,
} from '@sc/api';

import type { AppActivity, OwnerAnswer, OwnerAuthentication } from '@/services/ports';

export interface FakeServerAccount {
  readonly id: string;
  readonly username: string;
  password: string;
  /** Every record, tombstones included, by `kind/key`. */
  readonly records: Map<string, AccountRecord>;
}

export interface FakeServer {
  readonly plugin: Plugin;
  readonly calls: { infos: number; signIns: number; pulls: number; pushes: number; owners: number; creates: number; signOuts: number };
  /** Every push, as it arrived. */
  readonly pushed: (readonly AccountRecord[])[];
  maxProfiles: number;
  /** The account with this username — `sam` unless a test says otherwise — made on first use. */
  account(username?: string): FakeServerAccount;
  /** The live profiles' names, sorted. */
  profileNames(username?: string): readonly string[];
  /** A record as another device would store it, by the same rules. */
  put(record: AccountRecord, username?: string): PushOutcome;
  /** Every record back to what `snapshot` took: the server restored from an older copy. */
  snapshot(username?: string): () => void;
  /** The password changed elsewhere: every session goes, as PocketBase lets them go. */
  changePassword(password: string, username?: string): void;
  /** Every session ends — thirty days offline: each device signs in again with its saved password. */
  endSessions(): void;
  /** The next call, of any kind, fails with this. */
  failNext(error: AppError): void;
  /** The next pull fails with this: what comes after a sign-in, not the sign-in itself. */
  failNextPull(error: AppError): void;
  /** The next push is stored, and its answer lost on the way back. */
  loseNextAnswer(): void;
  /** Runs while the next pull is being read: a change made on the device in the middle of a run. */
  duringNextPull(action: () => Promise<void>): void;
  /** Refuses the writes this picks, as your server's validation would; `undefined` stops refusing. */
  refuseWrites(pick: ((record: AccountRecord) => PushRefusal | undefined) | undefined): void;
  /** Answer the owner check as throttled: too many wrong tries. */
  throttleOwner(throttle: boolean): void;
}

export interface FakeServerOptions {
  readonly id?: string;
  /** Accounts are created from the app with this invite (`signUp`). */
  readonly invite?: string;
  /** Asked for the account password again as its owner check, as your own server is. On by default. */
  readonly ownerProof?: boolean;
  readonly maxProfiles?: number;
}

/** The password every test account starts with, and the one `serverDraft` fills in. */
export const ACCOUNT_PASSWORD = 'the account password';

const REFUSED = 'refused';

export function fakeAccountServer(options: FakeServerOptions = {}): FakeServer {
  const accounts = new Map<string, FakeServerAccount>();
  const tokens = new Map<string, string>();
  const calls = { infos: 0, signIns: 0, pulls: 0, pushes: 0, owners: 0, creates: 0, signOuts: 0 };
  const pushed: (readonly AccountRecord[])[] = [];
  let issued = 0;
  let made = 0;
  let failNext: AppError | undefined;
  let failPull: AppError | undefined;
  let loseNext = false;
  let throttle = false;
  let duringPull: (() => Promise<void>) | undefined;
  let refusing: ((record: AccountRecord) => PushRefusal | undefined) | undefined;

  const server = {
    maxProfiles: options.maxProfiles ?? DEFAULT_MAX_PROFILES,
  };

  const make = (username: string, password = ACCOUNT_PASSWORD): FakeServerAccount => {
    made += 1;
    const account = { id: `account${made}`, username, password, records: new Map<string, AccountRecord>() };
    accounts.set(username, account);
    return account;
  };
  const accountOf = (username = 'sam') => accounts.get(username) ?? make(username);

  const failure = () => {
    const next = failNext;
    failNext = undefined;
    if (next) throw next;
  };
  const refused = () => new AppError('UNAUTHORIZED', 'Your server did not accept this username and password.', { retry: 'never' });
  const identity = (record: Pick<AccountRecord, 'kind' | 'key'>) => `${record.kind}/${record.key}`;
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  /** The passwords a write leaves: what it sends, and the stored one for a name it lists without a value. */
  const kept = (data: { readonly secretKeys: readonly string[]; readonly secrets: Credentials }, stored: Credentials): Credentials => {
    const next: Record<string, string> = {};
    for (const name of data.secretKeys) {
      const value = data.secrets[name] ?? stored[name];
      if (value !== undefined) next[name] = value;
    }
    return next;
  };

  /** One batch against a working copy: all of it stored, or the first write refused and nothing. */
  const store = (account: FakeServerAccount, records: readonly AccountRecord[]): PushOutcome => {
    const working = new Map(account.records);
    const refuse = (index: number, reason: PushRefusal): PushOutcome => ({ kind: 'refused', index, reason });
    for (const [index, record] of records.entries()) {
      if (!isAccountRecord(record)) return refuse(index, 'invalid');
      const picked = refusing?.(record);
      if (picked) return refuse(index, picked);
      const before = working.get(identity(record));
      if (record.deleted) {
        working.set(identity(record), { kind: record.kind, key: record.key, deleted: true } as AccountRecord);
        continue;
      }
      if ((record.kind === 'profile' || record.kind === 'connection') && before?.deleted) return refuse(index, 'deleted');
      // A child points at its parents, and PocketBase refuses a relation to a record it does not hold — deleted ones it does.
      const parents = record.data as Partial<Record<'userId' | 'connectionId', string>>;
      if (record.kind !== 'profile' && parents.userId !== undefined && !working.has(`profile/${parents.userId}`)) return refuse(index, 'invalid');
      if (record.kind !== 'connection' && parents.connectionId !== undefined && !working.has(`connection/${parents.connectionId}`)) return refuse(index, 'invalid');
      if (record.kind === 'profile' && !before) {
        const live = [...working.values()].filter((stored) => stored.kind === 'profile' && !stored.deleted).length;
        if (live >= server.maxProfiles) return refuse(index, 'limit');
      }
      const sent = copy(record);
      const keeps = (sent.kind === 'connection' || sent.kind === 'profileValues') && before && !before.deleted && before.kind === sent.kind;
      const next: AccountRecord = keeps
        ? ({ ...sent, data: { ...sent.data, secrets: kept(sent.data, (before.data as { readonly secrets: Credentials }).secrets) } } as AccountRecord)
        : sent;
      working.set(identity(next), next);
    }
    account.records.clear();
    for (const [key, record] of working) account.records.set(key, record);
    return { kind: 'stored' };
  };

  const connected = (target: { connectionId: ConnectedAccount['connectionId']; fields: Readonly<Record<string, unknown>> }, context: PluginContext) => {
    const username = String(target.fields.username ?? '');
    const statusOf = (account: FakeServerAccount): AccountStatus => ({ accountId: account.id, accountName: `${account.username} on the fake server` });

    const signIn = async (): Promise<FakeServerAccount> => {
      calls.signIns += 1;
      const password = (await context.credentials.read()).password ?? '';
      const account = accounts.get(username);
      if (!account || password !== account.password) {
        await context.session.write(REFUSED);
        throw refused();
      }
      issued += 1;
      const token = `token-${issued}`;
      tokens.set(token, username);
      await context.session.write(token);
      return account;
    };

    /** This device's account, signed in: with the session it has, or once with the saved password. */
    const live = async (): Promise<FakeServerAccount> => {
      failure();
      const token = await context.session.read();
      if (token === REFUSED) throw refused();
      const account = token === undefined ? undefined : accounts.get(tokens.get(token) ?? '');
      return account ?? signIn();
    };

    const account: ConnectedAccount = {
      connectionId: target.connectionId,
      info: async () => {
        calls.infos += 1;
        failure();
        return { serverVersion: 'test', maxProfiles: server.maxProfiles, signUp: options.invite === undefined ? 'closed' : 'invite' };
      },
      status: async () => statusOf(await live()),
      pull: async () => {
        calls.pulls += 1;
        const account = await live();
        const pullFailure = failPull;
        failPull = undefined;
        if (pullFailure) throw pullFailure;
        const records = copy([...account.records.values()]);
        const action = duringPull;
        duringPull = undefined;
        await action?.();
        return { records };
      },
      push: async (records) => {
        calls.pushes += 1;
        const account = await live();
        pushed.push(copy(records));
        const outcome = store(account, records);
        if (loseNext && outcome.kind === 'stored') {
          loseNext = false;
          throw new AppError('TIMEOUT', 'The answer never came back.', { retry: 'backoff' });
        }
        return outcome;
      },
      signOut: async () => {
        calls.signOuts += 1;
        const token = await context.session.read();
        if (token !== undefined) tokens.delete(token);
        await context.session.clear();
      },
      dispose: async () => undefined,
    };
    const verifyOwner = async (proof: Credentials) => {
      calls.owners += 1;
      const account = await live();
      if (throttle) throw new AppError('UNAUTHORIZED', 'Too many tries.', { retry: 'never', reason: 'too-many-attempts' });
      if (proof.password !== account.password) throw new AppError('UNAUTHORIZED', 'That password isn’t right.', { retry: 'never' });
    };
    const createAccount = async (fields: Readonly<Record<string, unknown>>, { firstProfile }: { readonly firstProfile: boolean }) => {
      calls.creates += 1;
      failure();
      if (fields.invite !== options.invite) throw new AppError('INVALID_STATE', 'That invite code is used, expired or unknown.', { retry: 'never' });
      if (accounts.has(username)) throw new AppError('INVALID_STATE', 'That username is taken on this server.', { retry: 'never' });
      const created = make(username, (await context.credentials.read()).password ?? '');
      if (firstProfile) {
        const key = `first-profile-of-${created.id}`;
        created.records.set(`profile/${key}`, { kind: 'profile', key, deleted: false, data: { userId: key as never, name: username } });
      }
      issued += 1;
      const token = `token-${issued}`;
      tokens.set(token, username);
      await context.session.write(token);
      return statusOf(created);
    };
    return {
      ...account,
      ...(options.ownerProof === false ? {} : { verifyOwner }),
      ...(options.invite === undefined ? {} : { createAccount }),
    };
  };

  const inviteField: Field = { key: 'invite', label: 'Invite code', type: 'text', required: true };
  const plugin: Plugin = {
    manifest: {
      id: pluginId(`sync/${options.id ?? 'fake-server'}`),
      category: 'sync',
      platforms: ['ios', 'android', 'web'],
      displayName: 'Fake server',
      description: 'A server that exists only in tests.',
      account: {
        ...(options.ownerProof === false ? {} : { ownerProof: { fields: ['password'] } }),
        ...(options.invite === undefined ? {} : { signUp: { fields: [inviteField] } }),
      },
      connectionFields: [
        { key: 'serverUrl', label: 'Server', type: 'url', required: true },
        { key: 'username', label: 'Username', type: 'text', required: true, credential: true },
        { key: 'password', label: 'Password', type: 'password', required: true },
      ],
      settings: [],
    },
    account: { connect: async (target, context) => connected(target, context) },
  };

  return {
    plugin,
    calls,
    pushed,
    get maxProfiles() {
      return server.maxProfiles;
    },
    set maxProfiles(value: number) {
      server.maxProfiles = value;
    },
    account: accountOf,
    profileNames: (username) =>
      [...accountOf(username).records.values()]
        .flatMap((record) => (record.kind === 'profile' && !record.deleted ? [record.data.name] : []))
        .sort(),
    put: (record, username) => store(accountOf(username), [record]),
    snapshot: (username) => {
      const account = accountOf(username);
      const saved = copy([...account.records.entries()]);
      return () => {
        account.records.clear();
        for (const [key, record] of saved) account.records.set(key, record);
      };
    },
    changePassword: (password, username) => {
      accountOf(username).password = password;
      for (const [token, owner] of tokens) if (owner === (username ?? 'sam')) tokens.delete(token);
    },
    endSessions: () => tokens.clear(),
    failNext: (error) => {
      failNext = error;
    },
    failNextPull: (error) => {
      failPull = error;
    },
    loseNextAnswer: () => {
      loseNext = true;
    },
    duringNextPull: (action) => {
      duringPull = action;
    },
    refuseWrites: (pick) => {
      refusing = pick;
    },
    throttleOwner: (next) => {
      throttle = next;
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
