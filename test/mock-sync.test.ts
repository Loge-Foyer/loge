import { syncCursor, userId, type ConnectedUserStateSyncProvider, type FieldValues, type SyncChange, type SyncCursor } from '@sc/api';
import { plugin } from '@sc/sync-mock';
import { describe, expect, it } from 'vitest';

import { fakeContext, fakeHttp, target } from './support/fake-http';

// The pretend accounts live for the whole test file, keyed by endpoint, so
// every test uses an endpoint of its own.
async function connect(endpoint: string, settings: FieldValues = {}) {
  const fake = fakeContext({ http: fakeHttp({}).client });
  const sync = plugin.sync;
  if (!sync) throw new Error('The mock has no sync role.');
  return { account: await sync.connect(target({ endpoint }, settings), fake.context), fake };
}

function profile(id: string, name: string): SyncChange {
  return { id, changedAt: 1, entity: 'profile', operation: 'upsert', data: { userId: userId(`u-${name.toLowerCase()}`), name } };
}

async function pullAll(account: ConnectedUserStateSyncProvider, from?: SyncCursor) {
  const changes: SyncChange[] = [];
  let cursor = from;
  for (;;) {
    const page = await account.pull(cursor);
    if (page.kind !== 'changes') throw new Error(`pull answered ${page.kind}`);
    changes.push(...page.changes);
    cursor = page.cursor;
    if (!page.more) return { changes, cursor };
  }
}

describe('mock — the pretend account', () => {
  it('declares only what the app can carry, and implements it', async () => {
    expect(plugin.manifest.sync?.capabilities).toEqual(['profile', 'preferences', 'providerConnections']);
    const { account } = await connect('mock://declares');
    expect(await account.getStatus()).toEqual({ accountName: 'mock://declares' });
    await expect(account.verifyOwner?.({})).resolves.toBeUndefined();
  });

  it('stores a change once, however often it is sent, and accepts it every time', async () => {
    const { account } = await connect('mock://idempotent');
    const changes = [profile('c1', 'Alex'), profile('c2', 'Sam')];
    expect(await account.push(changes)).toEqual({ accepted: ['c1', 'c2'] });
    expect(await account.push(changes)).toEqual({ accepted: ['c1', 'c2'] });
    expect((await pullAll(account)).changes.map((change) => change.id)).toEqual(['c1', 'c2']);
  });

  it('ends the accepted prefix at the first change it refuses', async () => {
    const { account } = await connect('mock://refuses');
    const bad = { ...profile('c2', 'Sam'), entity: 'watchProgress' } as unknown as SyncChange;
    expect(await account.push([profile('c1', 'Alex'), bad, profile('c3', 'Robin')])).toEqual({ accepted: ['c1'] });
    expect((await pullAll(account)).changes.map((change) => change.id)).toEqual(['c1']);
  });

  it('stores half the batch on every third push when flaky', async () => {
    const { account } = await connect('mock://flaky', { latency: 'flaky' });
    const batch = (from: number) => [0, 1, 2, 3].map((index) => profile(`c${from + index}`, `P${from + index}`));
    expect((await account.push(batch(0))).accepted).toHaveLength(4);
    expect((await account.push(batch(10))).accepted).toHaveLength(4);
    expect(await account.push(batch(20))).toEqual({ accepted: ['c20', 'c21'] });
  });

  it('waits on the clock when slow', async () => {
    const { account, fake } = await connect('mock://slow', { latency: 'slow' });
    await account.getStatus();
    expect(fake.sleeps).toEqual([1_500]);
  });

  it('returns the caller’s own changes, and resumes from a cursor', async () => {
    const { account } = await connect('mock://resume');
    await account.push([profile('c1', 'Alex')]);
    const first = await pullAll(account);
    expect(first.changes.map((change) => change.id)).toEqual(['c1']);
    await account.push([profile('c2', 'Sam')]);
    expect((await pullAll(account, first.cursor)).changes.map((change) => change.id)).toEqual(['c2']);
  });

  it('pages the log fifty at a time', async () => {
    const { account } = await connect('mock://pages');
    await account.push(Array.from({ length: 120 }, (_, index) => profile(`c${index}`, `P${index}`)));
    const sizes: number[] = [];
    let cursor: SyncCursor | undefined;
    for (;;) {
      const page = await account.pull(cursor);
      if (page.kind !== 'changes') throw new Error(page.kind);
      sizes.push(page.changes.length);
      cursor = page.cursor;
      if (!page.more) break;
    }
    expect(sizes).toEqual([50, 50, 20]);
  });

  it('shares one account between connections to one endpoint, and keeps endpoints apart', async () => {
    const one = (await connect('mock://shared')).account;
    const two = (await connect('mock://shared')).account;
    const other = (await connect('mock://elsewhere')).account;
    await one.push([profile('c1', 'Alex')]);
    expect((await pullAll(two)).changes.map((change) => change.id)).toEqual(['c1']);
    expect((await pullAll(other)).changes).toEqual([]);
  });

  it('answers reset for a cursor it did not give out — as after a reload', async () => {
    const { account } = await connect('mock://reset');
    expect(await account.pull(syncCursor('an-older-epoch.3'))).toEqual({ kind: 'reset' });
    expect(await account.pull(syncCursor('nonsense'))).toEqual({ kind: 'reset' });
  });

  it('keeps what it stored apart from the caller’s objects', async () => {
    const { account } = await connect('mock://copies');
    const change = profile('c1', 'Alex');
    await account.push([change]);
    const [stored] = (await pullAll(account)).changes;
    expect(stored).toEqual(change);
    expect(stored).not.toBe(change);
  });

  it('seeds mock://household with two profiles, one of them locked', async () => {
    const { account } = await connect('mock://household');
    expect((await pullAll(account)).changes).toEqual([
      { id: 'household:1', changedAt: 0, entity: 'profile', operation: 'upsert', data: { userId: 'household-sam', name: 'Sam' } },
      { id: 'household:2', changedAt: 0, entity: 'pin', operation: 'upsert', data: { userId: 'household-sam', pin: '1234' } },
      { id: 'household:3', changedAt: 0, entity: 'profile', operation: 'upsert', data: { userId: 'household-robin', name: 'Robin' } },
    ]);
  });
});
