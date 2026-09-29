import {
  AppError,
  connectionId,
  syncCursor,
  TransportError,
  userId,
  type ConnectedUserStateSyncProvider,
  type FieldValues,
  type PluginCrypto,
  type SyncChange,
} from '@sc/api';
import { plugin } from '@sc/sync-custom-server';
import { describe, expect, it } from 'vitest';

import { fakeContext } from './support/fake-http';
import { fakeSyncServer, type FakeSyncServer } from './support/fake-sync-server';
import { nodeCrypto, quickCrypto } from './support/node-crypto';

const PASSWORD = 'correct horse battery';
const FIELDS = { serverUrl: 'https://sync.example.com', username: 'family' };

interface DeviceOptions {
  readonly fields?: FieldValues;
  readonly password?: string;
  /** What an earlier provider of this device left in its session store — a relaunch. */
  readonly session?: string | undefined;
  readonly installationId?: string;
  /** The real key derivation, 600,000 iterations and all, rather than the quick one that counts. */
  readonly realCrypto?: boolean;
}

/** One device: a provider, the context it runs in, and its session store. */
async function device(server: FakeSyncServer, options: DeviceOptions = {}) {
  const quick = quickCrypto();
  const crypto: PluginCrypto = options.realCrypto ? nodeCrypto() : quick;
  const fake = fakeContext({
    http: server.http.client,
    credentials: { password: options.password ?? PASSWORD },
    crypto,
    ...(options.session ? { session: options.session } : {}),
    ...(options.installationId ? { installationId: options.installationId } : {}),
  });
  const sync = plugin.sync;
  if (!sync) throw new Error('custom-server has no sync role');
  const provider = await sync.connect({ connectionId: connectionId('account'), fields: options.fields ?? FIELDS, settings: {} }, fake.context);
  return { provider, fake, derivations: quick.derivations };
}

/** An account on the server, made the way the app makes one. */
async function withAccount(server: FakeSyncServer, fields: FieldValues = FIELDS) {
  const creator = await device(server, { installationId: 'creator', fields });
  await creator.provider.createAccount?.({ invite: 'GOOD-INVITE' });
  return creator;
}

function profile(id: string, name: string, pad = 0): SyncChange {
  return {
    id,
    changedAt: 1,
    entity: 'preferences',
    operation: 'upsert',
    data: { userId: userId(`u-${name.toLowerCase()}`), key: 'note', value: 'x'.repeat(pad) },
  };
}

const failure = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('It did not fail.');
};

const requestsCarry = (server: FakeSyncServer, text: string) =>
  server.http.requests.some((request) => JSON.stringify(request).includes(text));

describe('custom-server — your own sync server as the account', () => {
  it('declares what it implements: sealed passwords, an owner proof, and sign-up with an invite', () => {
    expect(plugin.manifest.sync).toMatchObject({
      capabilities: ['profile', 'preferences', 'providerConnections', 'sealedPasswords'],
      ownerProof: { fields: ['password'] },
      signUp: { fields: [{ key: 'invite', type: 'text', required: true }] },
    });
    expect(plugin.manifest.connectionFields.map((field) => [field.key, field.type])).toEqual([
      ['serverUrl', 'url'],
      ['username', 'text'],
      ['password', 'password'],
    ]);
  });

  describe('signing in', () => {
    it('reduces the address to its base, and signs in with a derived proof — never the password', async () => {
      const server = fakeSyncServer({ base: '/sync' });
      await withAccount(server, { serverUrl: 'https://home.example.com/sync', username: 'family' });
      const start = server.http.requests.length;
      const { provider } = await device(server, { fields: { serverUrl: '  https://home.example.com/sync/?from=app#top ', username: ' Family ' } });
      expect(await provider.getStatus()).toEqual({ accountName: 'family on home.example.com' });
      const [login] = server.to('POST /v1/auth/login');
      const body = JSON.parse(login?.body ?? '{}') as Record<string, unknown>;
      expect(body).toMatchObject({ username: 'family', installation: 'install-1', deviceName: 'Test Phone' });
      expect(String(body.proof)).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(requestsCarry(server, PASSWORD)).toBe(false);
      // The proof goes in its body field, and nowhere else.
      const others = server.http.requests.slice(start).filter((request) => request !== login);
      expect(others.length).toBeGreaterThan(0);
      expect(others.some((request) => JSON.stringify(request).includes(String(body.proof)))).toBe(false);
      expect(login?.headers.Authorization).toBeUndefined();
    });

    it('derives with the real key derivation, and the vault key opens on a second device', async () => {
      const server = fakeSyncServer();
      const first = await device(server, { realCrypto: true, installationId: 'one' });
      await first.provider.createAccount?.({ invite: 'GOOD-INVITE' });
      const second = await device(server, { realCrypto: true, installationId: 'two' });
      expect(await second.provider.vaultKey?.()).toEqual(await first.provider.vaultKey?.());
    });

    it('keeps its session: another provider of this device signs in no more, and derives nothing', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const first = await device(server);
      await first.provider.getStatus();
      const again = await device(server, { session: first.fake.session() });
      await again.provider.pull(undefined);
      await again.provider.vaultKey?.();
      expect(server.to('POST /v1/auth/login')).toHaveLength(1);
      expect(again.derivations()).toBe(0);
    });

    it('signs in once for calls made together', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const { provider, derivations } = await device(server);
      await Promise.all([provider.pull(undefined), provider.push([profile('c1', 'Alex')]), provider.getStatus(), provider.vaultKey?.()]);
      expect(server.to('POST /v1/auth/login')).toHaveLength(1);
      expect(derivations()).toBe(1);
    });

    it('stops a caller’s own wait when its signal aborts, and never the sign-in the others share', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const { provider } = await device(server);
      const controller = new AbortController();
      const waiting = provider.pull(undefined, controller.signal);
      const other = provider.getStatus();
      controller.abort();
      expect(await failure(waiting)).toBeInstanceOf(TransportError);
      await expect(other).resolves.toEqual({ accountName: 'family on sync.example.com' });
      expect(server.to('POST /v1/auth/login')).toHaveLength(1);
    });

    it('refuses weak parameters before deriving anything, and asks the server nothing more', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      server.override('POST /v1/auth/params', { status: 200, json: { kdf: { algorithm: 'pbkdf2-sha256', iterations: 1_000, salt: 'AAAAAAAAAAAAAAAAAAAAAA' } } });
      const { provider, derivations } = await device(server);
      expect(await failure(provider.getStatus())).toMatchObject({ code: 'INVALID_STATE', retry: 'never' });
      expect(derivations()).toBe(0);
      expect(server.to('POST /v1/auth/login')).toHaveLength(0);
    });

    it('reads nothing it cannot understand as parameters', async () => {
      const server = fakeSyncServer();
      server.override('POST /v1/auth/params', { status: 200, text: '<html>a proxy’s page</html>' });
      const { provider } = await device(server);
      expect(await failure(provider.getStatus())).toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    });

    it('asks for nothing it cannot sign in with: no password, or a name no account can have', async () => {
      const server = fakeSyncServer();
      const noPassword = await device(server, { password: '' });
      expect(await failure(noPassword.provider.getStatus())).toMatchObject({ code: 'UNAUTHORIZED' });
      const badName = await device(server, { fields: { ...FIELDS, username: 'not a name!' } });
      expect(await failure(badName.provider.getStatus())).toMatchObject({ code: 'UNAUTHORIZED' });
      expect(server.http.requests).toEqual([]);
    });
  });

  describe('when the server says no', () => {
    it('tries a refused sign-in once, and never again', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const { provider } = await device(server, { password: 'the wrong password' });
      expect(await failure(provider.getStatus())).toMatchObject({ code: 'UNAUTHORIZED', retry: 'never' });
      expect(await failure(provider.pull(undefined))).toMatchObject({ code: 'UNAUTHORIZED' });
      expect(server.to('POST /v1/auth/login')).toHaveLength(1);
    });

    it('waits out a throttled sign-in without remembering it as refused', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      server.override('POST /v1/auth/login', { status: 429, json: { error: 'too-many-attempts' }, headers: { 'retry-after': '30' } });
      const { provider } = await device(server);
      expect(await failure(provider.getStatus())).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff', reason: 'too-many-attempts' });
      server.restore('POST /v1/auth/login');
      await expect(provider.getStatus()).resolves.toBeDefined();
    });

    it('takes a 401 as being let go: a tombstone, and no sign-in by itself — after a relaunch either', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const { provider, fake } = await device(server);
      await provider.pull(undefined);
      server.revokeAll();
      expect(await failure(provider.pull(undefined))).toMatchObject({ code: 'UNAUTHORIZED', reason: 'signed-out' });
      const before = server.http.requests.length;
      expect(await failure(provider.push([profile('c1', 'Alex')]))).toMatchObject({ reason: 'signed-out' });
      const relaunched = await device(server, { session: fake.session() });
      expect(await failure(relaunched.provider.getStatus())).toMatchObject({ reason: 'signed-out' });
      expect(await failure(relaunched.provider.vaultKey?.() ?? Promise.resolve())).toMatchObject({ reason: 'signed-out' });
      expect(server.http.requests.length).toBe(before);
      expect(server.to('POST /v1/auth/login')).toHaveLength(1);
    });

    it('tries a newer token this device saved meanwhile, once, before letting go', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const older = await device(server);
      await older.provider.pull(undefined);
      // Another provider of this installation signed in since — its token replaced this one's — and saved its session.
      const newer = await device(server);
      await newer.provider.getStatus();
      older.fake.setSession(newer.fake.session());
      await expect(older.provider.pull(undefined)).resolves.toMatchObject({ kind: 'changes' });
      expect(server.to('POST /v1/auth/login')).toHaveLength(2);
    });
  });

  describe('the log', () => {
    it('pulls from the cursor it was given, and passes reset and expired through', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const { provider } = await device(server);
      await provider.push([profile('c1', 'Alex'), profile('c2', 'Sam')]);
      const first = await provider.pull(undefined);
      expect(first).toMatchObject({ kind: 'changes', more: false });
      expect(first.kind === 'changes' && first.changes.map((change) => change.id)).toEqual(['c1', 'c2']);
      await provider.pull(syncCursor('at-1'));
      expect(server.to('GET /v1/sync/pull').at(-1)?.query).toEqual({ cursor: 'at-1' });
      server.override('GET /v1/sync/pull', { status: 200, json: { kind: 'reset' } });
      expect(await provider.pull(syncCursor('at-2'))).toEqual({ kind: 'reset' });
      server.override('GET /v1/sync/pull', { status: 200, json: { kind: 'expired' } });
      expect(await provider.pull(syncCursor('at-2'))).toEqual({ kind: 'expired' });
    });

    it('leaves out a change the contract does not allow, and refuses a page it cannot read', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const { provider } = await device(server);
      server.override('GET /v1/sync/pull', {
        status: 200,
        json: { kind: 'changes', changes: [profile('c1', 'Alex'), { id: 'c2', entity: 'watchProgress' }], cursor: 'at-2', more: false },
      });
      const page = await provider.pull(undefined);
      expect(page.kind === 'changes' && page.changes.map((change) => change.id)).toEqual(['c1']);
      server.override('GET /v1/sync/pull', { status: 200, json: { kind: 'changes', changes: 'nope', cursor: 'at-2', more: false } });
      expect(await failure(provider.pull(undefined))).toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    });

    it('pushes in requests of at most 4 MiB, the accepted prefix running across them', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const { provider } = await device(server);
      const changes = Array.from({ length: 20 }, (_, index) => profile(`c${index}`, `P${index}`, 250_000));
      expect(await provider.push(changes)).toEqual({ accepted: changes.map((change) => change.id) });
      const requests = server.to('POST /v1/sync/push');
      expect(requests.length).toBeGreaterThan(1);
      expect(requests.every((request) => (request.body ?? '').length <= 4 * 1024 * 1024)).toBe(true);
    });

    it('ends a push at a request that stored less than it was sent', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const { provider } = await device(server);
      await provider.getStatus();
      const changes = Array.from({ length: 20 }, (_, index) => profile(`c${index}`, `P${index}`, 250_000));
      server.override('POST /v1/sync/push', (request) => {
        const sent = (JSON.parse(request.body ?? '{}') as { changes: SyncChange[] }).changes.map((change) => change.id);
        return { status: 200, json: { accepted: sent.slice(0, 2) } };
      });
      expect(await provider.push(changes)).toEqual({ accepted: ['c0', 'c1'] });
      expect(server.to('POST /v1/sync/push')).toHaveLength(1);
    });

    it('answers what earlier requests stored when a later one fails', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const { provider } = await device(server);
      await provider.getStatus();
      const changes = Array.from({ length: 20 }, (_, index) => profile(`c${index}`, `P${index}`, 250_000));
      server.override('POST /v1/sync/push', (request, calls) => {
        if (calls > 1) return new TransportError('unreachable');
        const sent = (JSON.parse(request.body ?? '{}') as { changes: SyncChange[] }).changes.map((change) => change.id);
        return { status: 200, json: { accepted: sent } };
      });
      const { accepted } = await provider.push(changes);
      const first = (JSON.parse(server.to('POST /v1/sync/push')[0]?.body ?? '{}') as { changes: SyncChange[] }).changes;
      expect(accepted).toEqual(first.map((change) => change.id));
      expect(accepted.length).toBeLessThan(changes.length);
      // Nothing stored, and the failure is the answer.
      server.override('POST /v1/sync/push', new TransportError('unreachable'));
      expect(await failure(provider.push(changes))).toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    });

    it('sends nothing for nothing', async () => {
      const server = fakeSyncServer();
      const { provider } = await device(server);
      expect(await provider.push([])).toEqual({ accepted: [] });
      expect(server.http.requests).toEqual([]);
    });
  });

  describe('the vault key', () => {
    it('is the same on every device of the account, and never travels unwrapped', async () => {
      const server = fakeSyncServer();
      const creator = await withAccount(server);
      const other = await device(server, { installationId: 'other' });
      const key = await other.provider.vaultKey?.();
      expect(key).toHaveLength(32);
      expect(key).toEqual(await creator.provider.vaultKey?.());
      const plain = Buffer.from(key ?? new Uint8Array()).toString('base64url');
      expect(requestsCarry(server, plain)).toBe(false);
    });

    it('is an error, never a key, when what the server holds does not open', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const account = server.accounts.get('family');
      if (account) account.vault = Buffer.alloc(60, 7).toString('base64url');
      const { provider, fake } = await device(server);
      expect(await failure(provider.vaultKey?.() ?? Promise.resolve())).toMatchObject({ code: 'INVALID_STATE' });
      expect(fake.session()).toBeUndefined();
    });
  });

  describe('the owner check', () => {
    it('is right, wrong, throttled or signed out — and none of it changes how the provider signs in', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const { provider } = await device(server);
      await expect(provider.verifyOwner?.({ password: PASSWORD })).resolves.toBeUndefined();
      expect(await failure(provider.verifyOwner?.({ password: 'nope, not it' }) ?? Promise.resolve())).toMatchObject({ code: 'UNAUTHORIZED' });
      // A wrong proof is the owner's, not the saved password's: the provider still works.
      await expect(provider.pull(undefined)).resolves.toMatchObject({ kind: 'changes' });

      server.override('POST /v1/auth/verify', { status: 429, json: { error: 'too-many-attempts' } });
      expect(await failure(provider.verifyOwner?.({ password: PASSWORD }) ?? Promise.resolve())).toMatchObject({
        code: 'UNAUTHORIZED',
        reason: 'too-many-attempts',
      });
      server.restore('POST /v1/auth/verify');

      server.revokeAll();
      expect(await failure(provider.verifyOwner?.({ password: PASSWORD }) ?? Promise.resolve())).toMatchObject({
        code: 'UNAUTHORIZED',
        reason: 'signed-out',
      });
      expect(server.to('POST /v1/auth/login')).toHaveLength(1);
    });

    it('sends nothing for an empty password', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const { provider } = await device(server);
      await provider.getStatus();
      expect(await failure(provider.verifyOwner?.({ password: '' }) ?? Promise.resolve())).toMatchObject({ code: 'UNAUTHORIZED' });
      expect(server.to('POST /v1/auth/verify')).toHaveLength(0);
    });
  });

  describe('creating an account', () => {
    it('sends a fresh salt, the floor’s iterations, a proof and the wrapped vault key — never the password', async () => {
      const server = fakeSyncServer();
      const { provider, fake } = await device(server);
      expect(await provider.createAccount?.({ invite: ' GOOD-INVITE ' })).toEqual({ accountName: 'family on sync.example.com' });
      const body = JSON.parse(server.to('POST /v1/accounts')[0]?.body ?? '{}') as Record<string, Record<string, unknown>>;
      expect(body.kdf).toMatchObject({ algorithm: 'pbkdf2-sha256', iterations: 600_000 });
      expect(Buffer.from(String(body.kdf?.salt), 'base64url')).toHaveLength(16);
      expect(body).toMatchObject({ invite: 'GOOD-INVITE', username: 'family' });
      expect(requestsCarry(server, PASSWORD)).toBe(false);
      // Signed in by it: the session holds the vault key, and nothing signs in again.
      await provider.pull(undefined);
      expect(fake.session()).toBeDefined();
      expect(server.to('POST /v1/auth/login')).toHaveLength(0);
    });

    it('refuses in words, and tries nothing again by itself', async () => {
      const server = fakeSyncServer();
      const short = await device(server, { password: 'short' });
      expect(await failure(short.provider.createAccount?.({ invite: 'GOOD-INVITE' }) ?? Promise.resolve())).toMatchObject({
        code: 'INVALID_STATE',
        message: expect.stringMatching(/10 characters/),
      });
      expect(server.http.requests).toEqual([]);

      const unknown = await device(server);
      expect(await failure(unknown.provider.createAccount?.({ invite: 'USED-ALREADY' }) ?? Promise.resolve())).toMatchObject({
        code: 'INVALID_STATE',
        message: expect.stringMatching(/invite/),
      });
      await withAccount(server);
      server.invites.add('SECOND');
      const taken = await device(server);
      expect(await failure(taken.provider.createAccount?.({ invite: 'SECOND' }) ?? Promise.resolve())).toMatchObject({
        code: 'INVALID_STATE',
        message: expect.stringMatching(/taken/),
      });
      expect(server.to('POST /v1/accounts')).toHaveLength(3);
    });
  });

  describe('signing out', () => {
    it('lets this device’s token go once, and never signs in to do it', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const { provider, fake } = await device(server);
      await provider.getStatus();
      await provider.signOut?.();
      expect(server.to('POST /v1/auth/logout')).toHaveLength(1);
      expect(await failure(provider.pull(undefined))).toMatchObject({ reason: 'signed-out' });

      const fresh = await device(server);
      await fresh.provider.signOut?.();
      expect(server.to('POST /v1/auth/logout')).toHaveLength(1);
      expect(fresh.fake.session()).toBeUndefined();
      expect(fake.session()).toBeDefined();
    });
  });

  describe('errors', () => {
    it.each([
      [new TransportError('offline'), { code: 'OFFLINE', retry: 'network-change' }],
      [new TransportError('unreachable'), { code: 'PROVIDER_UNAVAILABLE', retry: 'backoff' }],
      [new TransportError('timeout'), { code: 'TIMEOUT', retry: 'backoff' }],
      [{ status: 404 }, { code: 'NOT_FOUND', retry: 'never' }],
      [{ status: 500 }, { code: 'PROVIDER_UNAVAILABLE', retry: 'backoff' }],
      [{ status: 503, json: { error: 'storage' } }, { code: 'PROVIDER_UNAVAILABLE', retry: 'backoff' }],
      [{ status: 400, json: { error: 'invalid' } }, { code: 'INVALID_STATE', retry: 'never' }],
      [{ status: 200, text: 'not json' }, { code: 'PROVIDER_UNAVAILABLE' }],
    ] as const)('maps %o', async (reply, expected) => {
      const server = fakeSyncServer();
      await withAccount(server);
      const { provider } = await device(server);
      await provider.getStatus();
      server.override('GET /v1/sync/pull', reply instanceof TransportError ? reply : { ...reply });
      const error = await failure(provider.pull(undefined));
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject(expected);
    });

    it('hands an abort back as it came', async () => {
      const server = fakeSyncServer();
      await withAccount(server);
      const { provider } = await device(server);
      await provider.getStatus();
      server.override('GET /v1/sync/pull', new TransportError('aborted'));
      expect(await failure(provider.pull(undefined))).toBeInstanceOf(TransportError);
    });
  });

  it('connects with nothing filled in, and asks nothing of the network until called', async () => {
    const server = fakeSyncServer();
    const sync = plugin.sync;
    if (!sync) throw new Error('custom-server has no sync role');
    const provider: ConnectedUserStateSyncProvider = await sync.connect(
      { connectionId: connectionId('empty'), fields: {}, settings: {} },
      fakeContext({ http: server.http.client }).context,
    );
    await provider.dispose();
    expect(server.http.requests).toEqual([]);
  });
});
