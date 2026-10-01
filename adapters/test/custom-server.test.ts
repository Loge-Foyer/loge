import { readFileSync } from 'node:fs';

import { connectionId, isAppError, TransportError, userId, type AccountRecord, type ConnectedAccount } from '@sc/api';
import { plugin } from '@sc/sync-custom-server';
import { describe, expect, it } from 'vitest';

import { fakeContext, target } from './support/fake-http';
import { derivedId, fakePocketBase } from './support/fake-pocketbase';

const SERVER = 'https://sync.example.com';

async function connect(server: ReturnType<typeof fakePocketBase>, username = 'alex', password = 'correct horse', session?: string) {
  const fake = fakeContext({ http: server.client, credentials: { password }, ...(session ? { session } : {}) });
  const role = plugin.account;
  if (!role) throw new Error('custom-server has no account role');
  const account = await role.connect(target({ serverUrl: `${SERVER}/`, username }), fake.context);
  return { account, fake };
}

async function thrown(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('expected it to throw');
}

const profile = (key: string, name: string): AccountRecord => ({ kind: 'profile', key, deleted: false, data: { userId: userId(key), name } });

describe('custom-server: signing in', () => {
  it('reads the server without signing in', async () => {
    const server = fakePocketBase({ maxProfiles: 4, signUp: 'open' });
    const { account } = await connect(server);
    expect(await account.info()).toEqual({ serverVersion: '0.2.0', maxProfiles: 4, signUp: 'open' });
    expect(server.to('POST /api/collections/users/auth-with-password')).toHaveLength(0);
  });

  it('says there is no server where something else answers', async () => {
    const server = fakePocketBase();
    server.override('GET /api/sc/info', { status: 404 });
    const { account } = await connect(server);
    expect(await thrown(account.info())).toMatchObject({ code: 'NOT_FOUND', retry: 'never' });
    server.override('GET /api/sc/info', { status: 200, json: { maxProfiles: 'ten' } });
    expect(await thrown(account.info())).toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('signs in once for every caller, and names the account after its user and host', async () => {
    const server = fakePocketBase();
    server.addAccount('Alex', 'correct horse');
    const { account, fake } = await connect(server);
    const [first, second] = await Promise.all([account.status(), account.status()]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ accountName: 'Alex on sync.example.com' });
    expect(server.to('POST /api/collections/users/auth-with-password')).toHaveLength(1);
    expect(JSON.parse(server.requests[0]?.body ?? '{}')).toEqual({ identity: 'alex', password: 'correct horse' });
    // The session is kept: a new provider on the same store signs in no more.
    const again = await connect(server, 'alex', 'correct horse', fake.session());
    await again.account.status();
    expect(server.to('POST /api/collections/users/auth-with-password')).toHaveLength(1);
  });

  it('never tries a refused sign-in again by itself', async () => {
    const server = fakePocketBase();
    server.addAccount('alex', 'correct horse');
    const { account, fake } = await connect(server, 'alex', 'wrong');
    expect(await thrown(account.status())).toMatchObject({ code: 'UNAUTHORIZED', retry: 'never' });
    expect(await thrown(account.status())).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await thrown(account.pull())).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(server.to('POST /api/collections/users/auth-with-password')).toHaveLength(1);
    // Latched in the session store: the next launch does not try either.
    const later = await connect(server, 'alex', 'wrong', fake.session());
    expect(await thrown(later.account.status())).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(server.to('POST /api/collections/users/auth-with-password')).toHaveLength(1);
  });

  it('asks for a password it does not have, without a request', async () => {
    const server = fakePocketBase();
    const { account } = await connect(server, 'alex', '');
    expect(await thrown(account.status())).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(server.requests).toHaveLength(0);
  });

  it('waits when throttled, and latches nothing: no password was judged', async () => {
    const server = fakePocketBase();
    server.addAccount('alex', 'correct horse');
    server.throttle(true);
    const { account } = await connect(server);
    expect(await thrown(account.status())).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff', reason: 'too-many-attempts' });
    server.throttle(false);
    await expect(account.status()).resolves.toMatchObject({ accountName: 'alex on sync.example.com' });
  });

  it('signs in once more when the session ended, with the saved password', async () => {
    const server = fakePocketBase();
    server.addAccount('alex', 'correct horse');
    const { account, fake } = await connect(server);
    await account.status();
    // Thirty days offline: the token no longer works.
    fake.setSession(JSON.stringify({ v: 2, token: 'token-gone', accountId: 'acct00000000001', username: 'alex' }));
    const fresh = await connect(server, 'alex', 'correct horse', fake.session());
    await expect(fresh.account.pull()).resolves.toEqual({ records: [] });
    expect(server.to('POST /api/collections/users/auth-with-password')).toHaveLength(2);
  });

  it('is let go when the password changed elsewhere: refused once, then latched', async () => {
    const server = fakePocketBase();
    server.addAccount('alex', 'correct horse');
    const { account } = await connect(server);
    await account.status();
    server.changePassword('alex', 'another long password');
    expect(await thrown(account.pull())).toMatchObject({ code: 'UNAUTHORIZED', retry: 'never' });
    expect(await thrown(account.pull())).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(server.to('POST /api/collections/users/auth-with-password')).toHaveLength(2);
  });

  it('forgets its session when signing out', async () => {
    const server = fakePocketBase();
    server.addAccount('alex', 'correct horse');
    const { account, fake } = await connect(server);
    await account.status();
    await account.signOut?.();
    expect(fake.session()).toBeUndefined();
  });

  it('gives an abort back to the caller as it came', async () => {
    const server = fakePocketBase();
    server.override('GET /api/sc/info', new TransportError('aborted'));
    const { account } = await connect(server);
    expect(await thrown(account.info())).toBeInstanceOf(TransportError);
  });
});

describe('custom-server: creating an account', () => {
  it('creates it with an invite, signed in at once, with a first profile when asked', async () => {
    const server = fakePocketBase();
    const { account } = await connect(server, 'robin', 'a long password');
    const status = await (account.createAccount as NonNullable<ConnectedAccount['createAccount']>)({ invite: ' GOOD-INVITE ' }, { firstProfile: true });
    expect(status.accountName).toBe('robin on sync.example.com');
    const pulled = await account.pull();
    expect(pulled.records).toEqual([expect.objectContaining({ kind: 'profile', deleted: false, data: expect.objectContaining({ name: 'robin' }) })]);
    expect(server.to('POST /api/collections/users/auth-with-password')).toHaveLength(0);
  });

  it('says why an account was not made', async () => {
    const server = fakePocketBase();
    server.addAccount('taken', 'a long password');
    const create = async (username: string, password: string, invite: string) => {
      const { account } = await connect(server, username, password);
      return thrown((account.createAccount as NonNullable<ConnectedAccount['createAccount']>)({ invite }, { firstProfile: false }));
    };
    expect(await create('robin', 'a long password', 'NOPE')).toMatchObject({ message: expect.stringContaining('invite code') });
    expect(await create('Taken', 'a long password', 'GOOD-INVITE')).toMatchObject({ message: expect.stringContaining('taken') });
    // Refused before a request: nothing is spent.
    const requests = server.requests.length;
    expect(await create('robin', 'short', 'GOOD-INVITE')).toMatchObject({ message: expect.stringContaining('8 characters') });
    expect(await create('r', 'a long password', 'GOOD-INVITE')).toMatchObject({ message: expect.stringContaining('3 to 50') });
    expect(server.requests.length).toBe(requests);
  });
});

describe('custom-server: the owner check', () => {
  it('checks the password typed again, never the saved one', async () => {
    const server = fakePocketBase();
    server.addAccount('alex', 'correct horse');
    const { account } = await connect(server);
    const verify = account.verifyOwner as NonNullable<ConnectedAccount['verifyOwner']>;
    await expect(verify({ password: 'correct horse' })).resolves.toBeUndefined();
    expect(await thrown(verify({ password: 'wrong' }))).toMatchObject({ code: 'UNAUTHORIZED', retry: 'never' });
    server.throttle(true);
    expect(await thrown(verify({ password: 'correct horse' }))).toMatchObject({ code: 'UNAUTHORIZED', reason: 'too-many-attempts' });
    // Nothing typed is no proof, and never counts as a miss.
    const requests = server.requests.length;
    expect(await thrown(verify({}))).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(server.requests.length).toBe(requests);
  });
});

describe('custom-server: moving records', () => {
  it('refreshes the session on every pull, and reads every collection whole', async () => {
    const server = fakePocketBase();
    server.addAccount('alex', 'correct horse');
    const { account } = await connect(server);
    await account.push([profile('u1', 'Alex'), { kind: 'pin', key: 'u1', deleted: false, data: { userId: userId('u1'), pin: null } }]);
    const pulled = await account.pull();
    expect(server.to('POST /api/collections/users/auth-refresh')).toHaveLength(1);
    expect(pulled.records).toEqual([profile('u1', 'Alex'), { kind: 'pin', key: 'u1', deleted: false, data: { userId: 'u1', pin: null } }]);
    for (const collection of ['profiles', 'profile_pins', 'preferences', 'connections', 'connection_profile_values']) {
      expect(server.to(`GET /api/collections/${collection}/records`)[0]?.query).toMatchObject({ sort: 'id', skipTotal: '1', page: '1' });
    }
  });

  it('pages through a collection until a page comes back short', async () => {
    const server = fakePocketBase({ maxProfiles: 1_000 });
    server.addAccount('alex', 'correct horse');
    const { account } = await connect(server);
    const many = Array.from({ length: 501 }, (_, index) => profile(`u${index}`, `Profile ${index}`));
    expect(await account.push(many)).toEqual({ kind: 'stored' });
    expect((await account.pull()).records).toHaveLength(501);
    expect(server.to('GET /api/collections/profiles/records').map((request) => request.query.page)).toEqual(['1', '2']);
  });

  it('writes each record under the id derived from the account and its key, parents by theirs', async () => {
    const server = fakePocketBase();
    const alex = server.addAccount('alex', 'correct horse');
    const { account } = await connect(server);
    await account.push([
      profile('u1', 'Alex'),
      {
        kind: 'connection',
        key: 'c1',
        deleted: false,
        data: {
          connectionId: connectionId('c1'),
          pluginId: 'sources/jellyfin' as never,
          label: 'Home',
          enabled: true,
          perProfile: 'credentials',
          fields: { serverUrl: 'http://jellyfin.local' },
          settings: {},
          secretKeys: ['password'],
          secrets: { password: 'swordfish' },
        },
      },
      { kind: 'profileValues', key: 'c1/u1', deleted: false, data: { connectionId: connectionId('c1'), userId: userId('u1'), off: false, fields: {}, settings: {}, secretKeys: [], secrets: {} } },
    ]);
    const batch = JSON.parse(server.to('POST /api/batch')[0]?.body ?? '{}') as { requests: { method: string; url: string; body: Record<string, unknown> }[] };
    expect(batch.requests.map((request) => [request.method, request.url])).toEqual([
      ['PUT', '/api/collections/profiles/records'],
      ['PUT', '/api/collections/connections/records'],
      ['PUT', '/api/collections/connection_profile_values/records'],
    ]);
    expect(batch.requests[2]?.body).toMatchObject({
      id: derivedId(alex.id, 'profileValues', 'c1/u1'),
      user: alex.id,
      connection: derivedId(alex.id, 'connection', 'c1'),
      profile: derivedId(alex.id, 'profile', 'u1'),
    });
    expect(batch.requests[1]?.body).toMatchObject({ plugin_id: 'sources/jellyfin', per_profile: 'credentials', secrets: { password: 'swordfish' } });
  });

  it('names the write a refused batch stopped at, and why', async () => {
    const server = fakePocketBase({ maxProfiles: 1 });
    server.addAccount('alex', 'correct horse');
    const { account } = await connect(server);
    expect(await account.push([profile('u1', 'Alex'), profile('u2', 'Sam')])).toEqual({ kind: 'refused', index: 1, reason: 'limit' });
    expect(await account.push([profile('u1', 'Alex'), { kind: 'profile', key: 'u1', deleted: true }])).toEqual({ kind: 'stored' });
    expect(await account.push([profile('u1', 'Alex again')])).toEqual({ kind: 'refused', index: 0, reason: 'deleted' });
    server.override('POST /api/batch', { status: 400, json: { data: { requests: { 0: { response: { data: { key: { code: 'sc_invalid' } } } } } } } });
    expect(await account.push([profile('u3', 'Robin')])).toEqual({ kind: 'refused', index: 0, reason: 'invalid' });
  });

  it('takes a batch that failed naming nothing for a busy server: nothing stored, nothing judged', async () => {
    const server = fakePocketBase();
    server.addAccount('alex', 'correct horse');
    server.override('POST /api/batch', { status: 400, json: { message: 'Batch transaction failed.', data: {} } });
    const { account } = await connect(server);
    expect(await thrown(account.push([profile('u1', 'Alex')]))).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff' });
  });

  it('sends nothing for nothing', async () => {
    const server = fakePocketBase();
    const { account } = await connect(server);
    expect(await account.push([])).toEqual({ kind: 'stored' });
    expect(server.requests).toHaveLength(0);
  });

  it('leaves out what the server holds that the api would refuse', async () => {
    const server = fakePocketBase();
    const alex = server.addAccount('alex', 'correct horse');
    server.put('alex', 'profiles', { id: derivedId(alex.id, 'profile', 'u1'), user: alex.id, key: 'u1', deleted: false, name: '   ' });
    server.put('alex', 'profiles', { id: derivedId(alex.id, 'profile', 'u2'), user: alex.id, key: 'u2', deleted: false, name: 'Sam' });
    const { account } = await connect(server);
    expect((await account.pull()).records).toEqual([profile('u2', 'Sam')]);
  });

  it('carries the shared fixtures there and back as they are', async () => {
    const fixtures = JSON.parse(readFileSync(new URL('../api/fixtures/account-records.json', import.meta.url), 'utf8')) as {
      readonly valid: readonly AccountRecord[];
    };
    for (const record of fixtures.valid) {
      const server = fakePocketBase();
      server.addAccount('alex', 'correct horse');
      const { account } = await connect(server);
      expect(await account.push([record]), JSON.stringify(record)).toEqual({ kind: 'stored' });
      expect((await account.pull()).records).toEqual([record]);
    }
  });

  it('throws only AppErrors', async () => {
    const server = fakePocketBase();
    server.addAccount('alex', 'correct horse');
    server.override('GET /api/collections/profiles/records', { status: 200, text: 'not json' });
    const { account } = await connect(server);
    const error = await thrown(account.pull());
    expect(isAppError(error)).toBe(true);
  });
});
