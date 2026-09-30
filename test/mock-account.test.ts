import { userId, type AccountRecord, type ConnectedAccount, type ConnectedBackupTarget } from '@sc/api';
import { plugin } from '@sc/sync-mock';
import { plugin as backups } from '@sc/sync-mock-backup';
import { describe, expect, it } from 'vitest';

import { fakeContext, fakeHttp, target } from './support/fake-http';

async function connect(endpoint: string, settings: Record<string, string> = {}) {
  const fake = fakeContext({ http: fakeHttp({}).client });
  const role = plugin.account;
  if (!role) throw new Error('the mock has no account role');
  return { account: await role.connect(target({ endpoint }, settings), fake.context), fake };
}

const profile = (key: string, name: string): AccountRecord => ({ kind: 'profile', key, deleted: false, data: { userId: userId(key), name } });

describe('the mock account', () => {
  it('is a pretend server account, with nothing to type for its owner', async () => {
    const { account } = await connect('mock://owner');
    expect(await account.info()).toMatchObject({ maxProfiles: 10, signUp: 'open' });
    expect(await account.status()).toMatchObject({ accountName: 'You on mock://owner' });
    await expect((account.verifyOwner as NonNullable<ConnectedAccount['verifyOwner']>)({})).resolves.toBeUndefined();
  });

  it('shares one account between every connection with the same endpoint', async () => {
    const first = await connect('mock://shared');
    const second = await connect('mock://shared');
    await first.account.push([profile('u1', 'Alex')]);
    expect((await second.account.pull()).records).toEqual([profile('u1', 'Alex')]);
    await expect((await connect('mock://elsewhere')).account.pull()).resolves.toEqual({ records: [] });
  });

  it('holds a household already, with a PIN', async () => {
    const { account } = await connect('mock://household');
    const { records } = await account.pull();
    expect(records.filter((record) => record.kind === 'profile').map((record) => !record.deleted && record.data.name)).toEqual(['Sam', 'Robin']);
    expect(records).toContainEqual({ kind: 'pin', key: 'household-sam', deleted: false, data: { userId: 'household-sam', pin: '1234' } });
  });

  it('stores a batch whole or not at all, and names the write refused', async () => {
    const { account } = await connect('mock://rules');
    expect(await account.push([profile('u1', 'Alex'), { kind: 'profile', key: 'u2', deleted: false, data: { userId: userId('u9'), name: 'Sam' } }])).toEqual({
      kind: 'refused',
      index: 1,
      reason: 'invalid',
    });
    expect((await account.pull()).records).toEqual([]);
    await account.push([{ kind: 'profile', key: 'u1', deleted: true }]);
    expect(await account.push([profile('u1', 'Alex')])).toEqual({ kind: 'refused', index: 0, reason: 'deleted' });
  });

  it('holds an account to its profile limit, counting live profiles only', async () => {
    const { account } = await connect('mock://limit');
    const ten = Array.from({ length: 10 }, (_, index) => profile(`u${index}`, `Profile ${index}`));
    expect(await account.push(ten)).toEqual({ kind: 'stored' });
    expect(await account.push([profile('u10', 'One too many')])).toEqual({ kind: 'refused', index: 0, reason: 'limit' });
    expect(await account.push([{ kind: 'profile', key: 'u0', deleted: true }, profile('u10', 'Room now')])).toEqual({ kind: 'stored' });
  });

  it('keeps a password a write lists without its value', async () => {
    const { account } = await connect('mock://secrets');
    const connection = (secrets: Record<string, string>): AccountRecord => ({
      kind: 'connection',
      key: 'c1',
      deleted: false,
      data: {
        connectionId: 'c1' as never,
        pluginId: 'sources/mock' as never,
        label: 'Mock',
        enabled: true,
        perProfile: 'none',
        fields: {},
        settings: {},
        secretKeys: ['password'],
        secrets,
      },
    });
    await account.push([connection({ password: 'first' })]);
    await account.push([connection({})]);
    const [stored] = (await account.pull()).records;
    expect(stored?.deleted === false && stored.kind === 'connection' && stored.data.secrets).toEqual({ password: 'first' });
  });

  it('creates an account with a first profile, once', async () => {
    const { account } = await connect('mock://new');
    const create = account.createAccount as NonNullable<ConnectedAccount['createAccount']>;
    await create({}, { firstProfile: true });
    expect((await account.pull()).records).toEqual([expect.objectContaining({ kind: 'profile', deleted: false })]);
    await expect(create({}, { firstProfile: true })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('is slow through the injected clock, and fails every third push when flaky', async () => {
    const slow = await connect('mock://slow', { latency: 'slow' });
    await slow.account.pull();
    expect(slow.fake.sleeps).toEqual([1_500]);
    const flaky = await connect('mock://flaky', { latency: 'flaky' });
    await flaky.account.push([profile('u1', 'A')]);
    await flaky.account.push([profile('u2', 'B')]);
    await expect(flaky.account.push([profile('u3', 'C')])).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff' });
    expect((await flaky.account.pull()).records).toHaveLength(2);
  });
});

describe('the mock backup target', () => {
  async function place(endpoint: string): Promise<ConnectedBackupTarget> {
    const role = backups.backup;
    if (!role) throw new Error('the mock has no backup role');
    return role.connect(target({ endpoint }), fakeContext({ http: fakeHttp({}).client }).context);
  }

  it('keeps bytes, and refuses to overwrite a file changed since its etag', async () => {
    const drive = await place('mock://drive');
    const first = await drive.write('account.scbackup', new Uint8Array([1, 2, 3]));
    expect(await drive.stat('account.scbackup')).toEqual(first);
    const second = await drive.write('account.scbackup', new Uint8Array([4]), first.etag);
    await expect(drive.write('account.scbackup', new Uint8Array([5]), first.etag)).rejects.toMatchObject({ code: 'SYNC_CONFLICT' });
    const read = await drive.read('account.scbackup');
    expect([...read.bytes]).toEqual([4]);
    expect(read.stat).toEqual(second);
    expect(await drive.list()).toEqual([second]);
    expect(await (await place('mock://other')).list()).toEqual([]);
  });
});
