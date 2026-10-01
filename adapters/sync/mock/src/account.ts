import {
  AppError,
  DEFAULT_MAX_PROFILES,
  isAccountRecord,
  userId,
  type AccountRecord,
  type ConnectedAccount,
  type PluginContext,
  type PluginTarget,
  type PushOutcome,
} from '@sc/api';

const SLOW_MS = 1_500;
const DEFAULT_ENDPOINT = 'mock://account';
const HOUSEHOLD = 'mock://household';

/** A pretend PocketBase account: its records by kind and key, deleted ones included. */
interface PretendAccount {
  readonly id: string;
  readonly records: Map<string, AccountRecord>;
}

// Every connection in this runtime with the same endpoint shares one pretend
// account. It lasts as long as the runtime: a reload forgets it, and the
// devices put back what it lost — as they would for a server restored from an
// old backup.
const accounts = new Map<string, PretendAccount>();

const keyOf = (record: Pick<AccountRecord, 'kind' | 'key'>) => `${record.kind}/${record.key}`;

function accountAt(endpoint: string): PretendAccount {
  const existing = accounts.get(endpoint);
  if (existing) return existing;
  const account: PretendAccount = { id: `mock-${accounts.size + 1}`, records: new Map() };
  if (endpoint === HOUSEHOLD) for (const record of householdSeed()) account.records.set(keyOf(record), record);
  accounts.set(endpoint, account);
  return account;
}

/** A household that already has profiles — one with a PIN — so "the account replaces this device's" can be tried in the app. */
function householdSeed(): readonly AccountRecord[] {
  const sam = userId('household-sam');
  const robin = userId('household-robin');
  return [
    { kind: 'profile', key: sam, deleted: false, data: { userId: sam, name: 'Sam' } },
    { kind: 'pin', key: sam, deleted: false, data: { userId: sam, pin: '1234' } },
    { kind: 'profile', key: robin, deleted: false, data: { userId: robin, name: 'Robin' } },
  ];
}

/**
 * Plays at being your own server, in memory: records with soft deletes, a
 * profile limit, passwords a write lists but leaves out kept — and none of
 * the network. It cannot link two devices.
 */
export function createAccount(target: PluginTarget, context: PluginContext): ConnectedAccount {
  const { connectionId, fields, settings } = target;
  const endpoint = typeof fields.endpoint === 'string' && fields.endpoint.trim() !== '' ? fields.endpoint.trim() : DEFAULT_ENDPOINT;
  let pushes = 0;

  const latency = async () => {
    if (settings.latency === 'slow') await context.clock.sleep(SLOW_MS);
  };
  const statusOf = () => ({ accountId: accountAt(endpoint).id, accountName: `You on ${endpoint}` });

  return {
    connectionId,
    info: async () => ({ serverVersion: 'mock', maxProfiles: DEFAULT_MAX_PROFILES, signUp: 'open' }),
    status: async () => {
      await latency();
      return statusOf();
    },
    createAccount: async (_fields, { firstProfile }) => {
      await latency();
      const account = accountAt(endpoint);
      if (account.records.size > 0) throw new AppError('INVALID_STATE', 'There is an account at this endpoint already.', { retry: 'never' });
      if (firstProfile) {
        const first = userId(`${account.id}-you`);
        account.records.set(`profile/${first}`, { kind: 'profile', key: first, deleted: false, data: { userId: first, name: 'You' } });
      }
      return statusOf();
    },
    // The mock vouches for its owner: there is nothing to type.
    verifyOwner: async () => latency(),
    pull: async () => {
      await latency();
      return { records: copied([...accountAt(endpoint).records.values()]) };
    },
    push: async (records) => {
      await latency();
      pushes += 1;
      // Every third push fails before anything is stored, as a busy server's would.
      if (settings.latency === 'flaky' && pushes % 3 === 0) {
        throw new AppError('PROVIDER_UNAVAILABLE', 'The pretend account is flaky today.', { retry: 'backoff' });
      }
      return store(accountAt(endpoint), records);
    },
    signOut: async () => {},
    dispose: async () => {},
  };
}

/** One batch, all or nothing, judged as your own server judges it. */
function store(account: PretendAccount, records: readonly AccountRecord[]): PushOutcome {
  const next = new Map(account.records);
  for (const [index, record] of records.entries()) {
    if (!isAccountRecord(record)) return { kind: 'refused', index, reason: 'invalid' };
    const key = keyOf(record);
    const before = next.get(key);
    // Deleted stays deleted: their ids are random, and never come back.
    if ((record.kind === 'profile' || record.kind === 'connection') && before?.deleted && !record.deleted) {
      return { kind: 'refused', index, reason: 'deleted' };
    }
    if (record.kind === 'profile' && !record.deleted && !before) {
      const live = [...next.values()].filter((stored) => stored.kind === 'profile' && !stored.deleted).length;
      if (live >= DEFAULT_MAX_PROFILES) return { kind: 'refused', index, reason: 'limit' };
    }
    next.set(key, record.deleted ? { kind: record.kind, key: record.key, deleted: true } : withKeptSecrets(record, before));
  }
  account.records.clear();
  for (const [key, record] of next) account.records.set(key, record);
  return { kind: 'stored' };
}

/** A password the write lists without its value keeps the stored one; one it no longer lists goes. */
function withKeptSecrets(record: AccountRecord, before: AccountRecord | undefined): AccountRecord {
  if (record.deleted || (record.kind !== 'connection' && record.kind !== 'profileValues')) return record;
  const stored = before && !before.deleted && (before.kind === 'connection' || before.kind === 'profileValues') ? before.data.secrets : {};
  const secrets: Record<string, string> = {};
  for (const name of record.data.secretKeys) {
    const value = record.data.secrets[name] ?? stored[name];
    if (value !== undefined) secrets[name] = value;
  }
  return record.kind === 'connection' ? { ...record, data: { ...record.data, secrets } } : { ...record, data: { ...record.data, secrets } };
}

/** What a server answers is a copy: a caller changing it changes nothing here. */
function copied<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
