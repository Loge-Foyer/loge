import { connectionId, credentialsRef, pluginId, userId, type Connection, type ConnectionId, type MediaDetail } from '@sc/api';
import { describe, expect, it } from 'vitest';

import type { LocalDatabase, ProfileValues, StoredAccount } from '@/services/ports';

import { ENGINES, openTestDatabase, reopenable, type Engine, type TestDatabaseOptions } from './support/engines';
import { fakeClock } from './support/fakes';
import { movie } from './support/services';

const kids = { id: userId('u-kids'), name: 'Kids' };
const alex = { id: userId('u-alex'), name: 'Alex' };

function connection(id: string, extra: Partial<Connection> = {}): Connection {
  return {
    id: connectionId(id),
    pluginId: pluginId('sources/fake'),
    label: id,
    enabled: true,
    perProfile: 'credentials',
    values: { fields: { serverUrl: 'http://home' }, settings: { cacheMetadata: true } },
    ...extra,
  };
}

const ownValues: ProfileValues = {
  fields: { username: 'alex' },
  settings: {},
  credentialsRef: credentialsRef('ref-alex'),
  secretKeys: ['password'],
};

const layout = { version: 1 as const, rows: [{ id: 'continue', type: 'continue' as const, hidden: false }] };

function savedList(connection: ConnectionId, savedAt = 1) {
  return { items: [movie(connection, 'm1', 2020)], savedAt };
}

function detailOf(connection: ConnectionId, id: string): MediaDetail {
  return { item: movie(connection, id, 2020), people: [], studios: [], externalIds: {} };
}

describe.each(ENGINES)('the database on %s', (engine: Engine) => {
  const open = (where: Pick<TestDatabaseOptions, 'path' | 'indexedDB'> = {}) => {
    const clock = fakeClock();
    return { clock, db: openTestDatabase(engine, { clock, ...where }) };
  };

  /** Alex and Kids, a connection each of them keeps values on, and something saved for Alex. */
  async function household(db: LocalDatabase) {
    const home = connection('c-home');
    await db.users.insert(kids);
    await db.users.insert(alex);
    await db.connections.insert(home);
    await db.connections.putProfileValues(home.id, alex.id, ownValues);
    await db.connections.putProfileValues(home.id, kids.id, { fields: { username: 'kids' }, settings: {} });
    await db.preferences.update(alex.id, () => ({ homeLayout: layout }));
    await db.mediaCache.putList(alex.id, home.id, 'row:movies', 'print-1', savedList(home.id));
    await db.mediaCache.putDetail(alex.id, 'print-1', { detail: detailOf(home.id, 'm1'), savedAt: 1 });
    return home;
  }

  describe('profiles and connections', () => {
    it('lists them in the order they were created, not by id', async () => {
      const { db } = open();
      await db.users.insert(kids);
      await db.users.insert(alex);
      await db.connections.insert(connection('c-2'));
      await db.connections.insert(connection('c-1'));
      expect((await db.users.list()).map((user) => user.name)).toEqual(['Kids', 'Alex']);
      expect((await db.connections.list()).map((row) => row.id)).toEqual(['c-2', 'c-1']);

      await db.users.delete(kids.id);
      await db.users.insert({ id: userId('u-a'), name: 'Ana' });
      expect((await db.users.list()).map((user) => user.name)).toEqual(['Alex', 'Ana']);
    });

    it('reads back exactly what was written', async () => {
      const { db } = open();
      const withPin = { ...alex, pinCredentialRef: credentialsRef('pin-1') };
      const home = connection('c-home', {
        enabled: false,
        values: {
          fields: { serverUrl: 'http://home', localOnly: true },
          settings: { libraries: { mode: 'only', ids: ['a', 'b'] } },
          credentialsRef: credentialsRef('ref-1'),
          secretKeys: ['password'],
        },
      });
      await db.users.insert(withPin);
      await db.connections.insert(home);
      await db.connections.putProfileValues(home.id, alex.id, { fields: {}, settings: {}, off: true });
      expect(await db.users.get(alex.id)).toEqual(withPin);
      expect(await db.connections.get(home.id)).toEqual(home);
      expect((await db.connections.profileValues(home.id)).get(alex.id)).toEqual({ fields: {}, settings: {}, off: true });
      expect(await db.users.get(userId('nobody'))).toBeUndefined();
    });

    it('refuses a second row with the same id, and an update of a missing one', async () => {
      const { db } = open();
      await db.users.insert(alex);
      await expect(db.users.insert(alex)).rejects.toThrow();
      await expect(db.users.update(kids)).rejects.toThrow();
      await expect(db.connections.update(connection('c-missing'))).rejects.toThrow();
    });

    it('updates a profile or a connection without touching what hangs off it', async () => {
      const { db } = open();
      const home = await household(db);
      await db.users.update({ ...alex, name: 'Alexandra' });
      await db.connections.update({ ...home, label: 'Home server' });

      expect((await db.users.get(alex.id))?.name).toBe('Alexandra');
      expect((await db.connections.profileValues(home.id)).get(alex.id)).toEqual(ownValues);
      expect((await db.preferences.get(alex.id)).homeLayout).toEqual(layout);
      expect(await db.mediaCache.list(alex.id, home.id, 'row:movies', 'print-1')).toBeDefined();
    });

    it('deletes what a profile owns along with it, and nothing of anyone else', async () => {
      const { db } = open();
      const home = await household(db);
      await db.users.delete(alex.id);

      expect((await db.connections.valuesOfProfile(alex.id)).size).toBe(0);
      expect(await db.preferences.get(alex.id)).toEqual({});
      expect(await db.mediaCache.list(alex.id, home.id, 'row:movies', 'print-1')).toBeUndefined();
      expect(await db.mediaCache.detail(alex.id, { connectionId: home.id, externalId: 'm1' }, 'print-1')).toBeUndefined();
      expect([...(await db.connections.profileValues(home.id)).keys()]).toEqual([kids.id]);
      expect(await db.connections.get(home.id)).toBeDefined();
    });

    it('deletes a connection’s per-profile values and saved media along with it', async () => {
      const { db } = open();
      const home = await household(db);
      await db.connections.delete(home.id);

      expect((await db.connections.valuesOfProfile(alex.id)).size).toBe(0);
      expect((await db.connections.valuesOfProfile(kids.id)).size).toBe(0);
      expect(await db.mediaCache.list(alex.id, home.id, 'row:movies', 'print-1')).toBeUndefined();
      expect((await db.preferences.get(alex.id)).homeLayout).toEqual(layout);
    });

    it('refuses values for a profile or a connection that does not exist', async () => {
      const { db } = open();
      const home = connection('c-home');
      await db.users.insert(alex);
      await db.connections.insert(home);
      await expect(db.connections.putProfileValues(connectionId('c-missing'), alex.id, ownValues)).rejects.toThrow();
      await expect(db.connections.putProfileValues(home.id, userId('u-missing'), ownValues)).rejects.toThrow();
      await expect(db.preferences.update(userId('u-missing'), () => ({ homeLayout: layout }))).rejects.toThrow();
    });

    it('lists each connection’s values by profile, and each profile’s by connection', async () => {
      const { db } = open();
      const home = await household(db);
      const other = connection('c-other');
      await db.connections.insert(other);
      await db.connections.putProfileValues(other.id, alex.id, { fields: { username: 'a2' }, settings: {} });

      expect([...(await db.connections.profileValues(home.id)).keys()]).toEqual([kids.id, alex.id]);
      expect([...(await db.connections.valuesOfProfile(alex.id)).keys()]).toEqual([home.id, other.id]);
      await db.connections.deleteProfileValues(home.id, alex.id);
      expect([...(await db.connections.valuesOfProfile(alex.id)).keys()]).toEqual([other.id]);
    });
  });

  describe('transactions', () => {
    it('keep every write or none', async () => {
      const { db } = open();
      await expect(
        db.transaction(async (tx) => {
          await tx.users.insert(alex);
          await tx.connections.insert(connection('c-home'));
          throw new Error('Something went wrong half-way.');
        }),
      ).rejects.toThrow('half-way');
      expect(await db.users.list()).toEqual([]);
      expect(await db.connections.list()).toEqual([]);
      expect(await db.journal.entries()).toEqual([]);
    });

    it('see their own writes, and return what the work returned', async () => {
      const { db } = open();
      const names = await db.transaction(async (tx) => {
        await tx.users.insert(alex);
        return (await tx.users.list()).map((user) => user.name);
      });
      expect(names).toEqual(['Alex']);
    });

    it('lose no update when two run at once', async () => {
      const { db } = open();
      await db.users.insert(alex);
      const adding = (id: string) =>
        db.preferences.update(alex.id, (current) => ({
          homeLayout: { version: 1, rows: [...(current.homeLayout?.rows ?? []), { id, type: 'continue', hidden: false }] },
        }));
      await Promise.all([adding('first'), adding('second'), db.deviceSettings.update((current) => ({ ...current, defaultUserId: alex.id }))]);
      expect((await db.preferences.get(alex.id)).homeLayout?.rows.map((row) => row.id)).toEqual(['first', 'second']);
      expect((await db.deviceSettings.get()).defaultUserId).toBe(alex.id);
    });

    it('refuse a call to the database from inside a transaction', async () => {
      const { db } = open();
      await expect(db.transaction(async () => db.users.list())).rejects.toThrow('called the database directly');
    });
  });

  describe('the change journal', () => {
    it('records each change in the order it happened, even within one millisecond', async () => {
      const { db } = open();
      const home = connection('c-home');
      await db.users.insert(alex);
      await db.connections.insert(home);
      await db.connections.putProfileValues(home.id, alex.id, ownValues);
      await db.preferences.update(alex.id, () => ({ homeLayout: layout }));
      await db.users.update({ ...alex, name: 'Alexandra' });
      await db.connections.deleteProfileValues(home.id, alex.id);
      await db.connections.delete(home.id);
      await db.users.delete(alex.id);

      const entries = await db.journal.entries();
      expect(entries.map((entry) => [entry.entity, entry.operation, entry.localVersion])).toEqual([
        ['user', 'upsert', 1],
        ['connection', 'upsert', 1],
        ['connectionProfileValues', 'upsert', 1],
        ['preferences', 'upsert', 1],
        ['user', 'upsert', 2],
        ['connectionProfileValues', 'delete', 2],
        ['connection', 'delete', 2],
        ['user', 'delete', 3],
      ]);
      const seqs = entries.map((entry) => entry.seq);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
      expect(new Set(entries.map((entry) => entry.changedAt)).size).toBe(1);
      expect(entries[2]).toMatchObject({ userId: alex.id, entityId: `${home.id}/${alex.id}` });
      expect(entries[3]).toMatchObject({ userId: alex.id, entityId: `${alex.id}/homeLayout` });
      expect(entries[1]?.userId).toBeUndefined();
    });

    it('records nothing for a write that changes nothing', async () => {
      const { db } = open();
      const home = await household(db);
      const before = (await db.journal.entries()).length;
      await db.users.update({ ...alex });
      await db.connections.update({ ...home, values: { ...home.values } });
      await db.connections.putProfileValues(home.id, alex.id, { ...ownValues });
      await db.preferences.update(alex.id, (current) => ({ ...current }));
      await db.connections.deleteProfileValues(home.id, userId('u-nobody'));
      expect(await db.journal.entries()).toHaveLength(before);
    });

    it('leaves device settings, saved media, the account’s own rows and cascaded rows out', async () => {
      const { db } = open();
      const home = await household(db);
      const before = await db.journal.entries();
      await db.deviceSettings.update((current) => ({ ...current, defaultUserId: alex.id }));
      await db.mediaCache.putList(alex.id, home.id, 'resume', 'print-1', savedList(home.id));
      await db.staleSecrets.add([credentialsRef('old')]);
      await db.account.put({ kind: 'local', id: 'account-1', name: 'Alex' });
      await db.account.putSync({ checkpoint: 3, heldBack: [] });
      await db.users.delete(alex.id);
      const added = (await db.journal.entries()).slice(before.length);
      expect(added.map((entry) => [entry.entity, entry.operation, entry.entityId])).toEqual([['user', 'delete', alex.id]]);
    });

    it('never journals a sync plugin’s connection: it is the device’s own', async () => {
      const { db } = open();
      await db.users.insert(alex);
      const before = (await db.journal.entries()).length;
      const server = connection('c-server', { pluginId: pluginId('sync/custom-server'), perProfile: 'none' });
      await db.connections.insert(server);
      await db.connections.update({ ...server, label: 'Renamed' });
      await db.connections.delete(server.id);
      expect(await db.journal.entries()).toHaveLength(before);
    });

    it('stores preferences key by key, so a reset is a deletion', async () => {
      const { db } = open();
      await db.users.insert(alex);
      await db.preferences.update(alex.id, () => ({ homeLayout: layout }));
      await db.preferences.update(alex.id, ({ homeLayout: _gone, ...rest }) => rest);
      expect(await db.preferences.get(alex.id)).toEqual({});
      const last = (await db.journal.entries()).at(-1);
      expect(last).toMatchObject({ entity: 'preferences', operation: 'delete', entityId: `${alex.id}/homeLayout` });
    });

    it('returns the entries after a given one', async () => {
      const { db } = open();
      await db.users.insert(alex);
      await db.users.insert(kids);
      const [first] = await db.journal.entries();
      const rest = await db.journal.entries(first?.seq);
      expect(rest.map((entry) => entry.entityId)).toEqual([kids.id]);
    });
  });

  describe('the journal and the account', () => {
    it('prunes what reached the account, and never reuses a seq — not even after a restart', async () => {
      const where = reopenable(engine);
      const first = open(where).db;
      await first.users.insert(alex);
      await first.users.insert(kids);
      await first.users.update({ ...kids, name: 'Kids, renamed' });
      const [one, two, three] = await first.journal.entries();
      await first.journal.prune(two?.seq ?? 0);
      expect((await first.journal.entries()).map((entry) => entry.seq)).toEqual([three?.seq]);
      await first.journal.prune(await first.journal.head());
      expect(await first.journal.entries()).toEqual([]);

      const again = open(where).db;
      await again.users.update({ ...alex, name: 'Alexandra' });
      const [next] = await again.journal.entries(0);
      expect(next?.seq).toBeGreaterThan(three?.seq ?? Infinity);
      expect(one?.seq).toBeLessThan(two?.seq ?? 0);
    });

    it('reads the journal inside a transaction, its own writes included', async () => {
      const { db } = open();
      await db.users.insert(alex);
      const seen = await db.transaction(async (tx) => {
        await tx.users.insert(kids);
        return { head: await tx.journal.head(), count: await tx.journal.count(0), entries: await tx.journal.entries(0, 1) };
      });
      expect(seen.count).toBe(2);
      expect(seen.head).toBe((await db.journal.entries()).at(-1)?.seq);
      expect(seen.entries.map((entry) => entry.entityId)).toEqual([alex.id]);
      expect(await db.journal.head()).toBe(seen.head);
      expect(await db.journal.count(seen.head)).toBe(0);
    });

    it('starts empty: head 0, nothing after it', async () => {
      const { db } = open();
      expect(await db.journal.head()).toBe(0);
      expect(await db.journal.entries()).toEqual([]);
    });

    it('writes without journaling on request, and journals again on the next write', async () => {
      const { db } = open();
      await db.unjournaled(async (tx) => {
        await tx.users.insert(alex);
        await tx.preferences.update(alex.id, () => ({ homeLayout: layout }));
      });
      expect(await db.journal.entries()).toEqual([]);
      expect((await db.preferences.get(alex.id)).homeLayout).toEqual(layout);
      await db.users.update({ ...alex, name: 'Alexandra' });
      expect((await db.journal.entries()).map((entry) => entry.entity)).toEqual(['user']);
    });

    it('announces changes by hand, even inside an unjournaled transaction', async () => {
      const { db } = open();
      await db.unjournaled(async (tx) => {
        await tx.users.insert(alex);
        await tx.journal.announce([{ userId: alex.id, entity: 'user', entityId: alex.id, operation: 'upsert', localVersion: 1 }]);
      });
      const [entry] = await db.journal.entries();
      expect(entry).toMatchObject({ entity: 'user', entityId: alex.id, userId: alex.id, operation: 'upsert', localVersion: 1 });
    });

    it('tells its listeners once a journaled commit is done — never for a rollback, a read or an unjournaled write', async () => {
      const { db } = open();
      let heard = 0;
      const stop = db.journal.subscribe(() => {
        heard += 1;
      });
      await db.users.insert(alex);
      expect(heard).toBe(1);
      await db.users.list();
      await db.unjournaled((tx) => tx.users.insert(kids));
      await db.users.update({ ...alex });
      expect(heard).toBe(1);
      await expect(
        db.transaction(async (tx) => {
          await tx.users.update({ ...alex, name: 'Alexandra' });
          throw new Error('changed my mind');
        }),
      ).rejects.toThrow('changed my mind');
      expect(heard).toBe(1);
      stop();
      await db.users.update({ ...alex, name: 'Alexandra' });
      expect(heard).toBe(1);
    });

    it('journals a rename and a PIN apart, so neither carries the other away', async () => {
      const { db } = open();
      await db.users.insert(alex);
      await db.users.update({ ...alex, name: 'Alexandra' });
      await db.users.update({ ...alex, name: 'Alexandra', pinCredentialRef: credentialsRef('pin-1') });
      await db.users.update({ ...alex, name: 'Alex', pinCredentialRef: credentialsRef('pin-2') });
      await db.users.update({ ...alex, name: 'Alex' });
      expect((await db.journal.entries()).map((entry) => [entry.entity, entry.localVersion])).toEqual([
        ['user', 1],
        ['user', 2],
        ['userPin', 3],
        ['user', 4],
        ['userPin', 4],
        ['userPin', 5],
      ]);
    });

    it('keeps one account, local or on a server, with how its sync stands', async () => {
      const where = reopenable(engine);
      const { db } = open(where);
      expect(await db.account.get()).toBeUndefined();
      expect(await db.account.sync()).toEqual({ checkpoint: 0, heldBack: [] });
      const local: StoredAccount = { kind: 'local', id: 'account-1', name: 'The Smiths' };
      await db.account.put(local);
      expect(await db.account.get()).toEqual(local);

      const server: StoredAccount = { kind: 'server', id: 'k4r9x2m1q8w3e5t', name: 'sam on home', connectionId: connectionId('c-server'), maxProfiles: 6 };
      await db.account.put(server);
      await db.account.putSync({ checkpoint: 12, lastSyncedAt: 5, heldBack: [alex.id] });
      const again = open(where).db;
      expect(await again.account.get()).toEqual(server);
      expect(await again.account.sync()).toEqual({ checkpoint: 12, lastSyncedAt: 5, heldBack: [alex.id] });
      await again.account.putSync({ checkpoint: 14, heldBack: [] });
      expect(await again.account.sync()).toEqual({ checkpoint: 14, heldBack: [] });

      await again.account.clear();
      expect(await again.account.get()).toBeUndefined();
      expect(await again.account.sync()).toEqual({ checkpoint: 0, heldBack: [] });
    });

    it('refuses the journal and the account, called directly from inside a transaction', async () => {
      const { db } = open();
      await expect(db.transaction(async () => db.journal.head())).rejects.toThrow('called the database directly');
      await expect(db.unjournaled(async () => db.account.get())).rejects.toThrow('called the database directly');
    });
  });

  describe('device settings', () => {
    it('start with no default profile, and keep what they are given', async () => {
      const { db } = open();
      expect(await db.deviceSettings.get()).toEqual({});
      await db.deviceSettings.update((current) => ({ ...current, defaultUserId: alex.id }));
      expect(await db.deviceSettings.get()).toEqual({ defaultUserId: alex.id });
      await db.deviceSettings.update(({ defaultUserId: _gone, ...rest }) => rest);
      expect(await db.deviceSettings.get()).toEqual({});
    });
  });

  describe('saved media', () => {
    it('is served only for the values it was saved with', async () => {
      const { db } = open();
      const home = await household(db);
      expect(await db.mediaCache.list(alex.id, home.id, 'row:movies', 'print-1')).toEqual(savedList(home.id));
      expect(await db.mediaCache.list(alex.id, home.id, 'row:movies', 'print-2')).toBeUndefined();
      expect(await db.mediaCache.list(kids.id, home.id, 'row:movies', 'print-1')).toBeUndefined();
      const key = { connectionId: home.id, externalId: 'm1' };
      expect((await db.mediaCache.detail(alex.id, key, 'print-1'))?.detail).toEqual(detailOf(home.id, 'm1'));
      expect(await db.mediaCache.detail(alex.id, key, 'print-2')).toBeUndefined();
    });

    it('is replaced in place, and can be removed entry by entry', async () => {
      const { db } = open();
      const home = await household(db);
      await db.mediaCache.putList(alex.id, home.id, 'row:movies', 'print-2', savedList(home.id, 5));
      expect((await db.mediaCache.list(alex.id, home.id, 'row:movies', 'print-2'))?.savedAt).toBe(5);
      expect(await db.mediaCache.list(alex.id, home.id, 'row:movies', 'print-1')).toBeUndefined();
      await db.mediaCache.removeList(alex.id, home.id, 'row:movies');
      await db.mediaCache.removeDetail(alex.id, { connectionId: home.id, externalId: 'm1' });
      expect(await db.mediaCache.list(alex.id, home.id, 'row:movies', 'print-2')).toBeUndefined();
      expect(await db.mediaCache.detail(alex.id, { connectionId: home.id, externalId: 'm1' }, 'print-1')).toBeUndefined();
    });

    it('is not saved for a profile or a connection that is gone', async () => {
      const { db } = open();
      const home = await household(db);
      await db.mediaCache.putList(userId('u-gone'), home.id, 'resume', 'print-1', savedList(home.id));
      await db.mediaCache.putList(alex.id, connectionId('c-gone'), 'resume', 'print-1', savedList(connectionId('c-gone')));
      await db.mediaCache.putDetail(userId('u-gone'), 'print-1', { detail: detailOf(home.id, 'm2'), savedAt: 1 });
      expect(await db.mediaCache.list(userId('u-gone'), home.id, 'resume', 'print-1')).toBeUndefined();
      expect(await db.mediaCache.list(alex.id, connectionId('c-gone'), 'resume', 'print-1')).toBeUndefined();
    });

    it('is purged for a connection, or for one profile’s use of it', async () => {
      const { db } = open();
      const home = await household(db);
      await db.mediaCache.putList(kids.id, home.id, 'row:movies', 'print-1', savedList(home.id));
      await db.mediaCache.purge(home.id, alex.id);
      expect(await db.mediaCache.list(alex.id, home.id, 'row:movies', 'print-1')).toBeUndefined();
      expect(await db.mediaCache.list(kids.id, home.id, 'row:movies', 'print-1')).toBeDefined();
      await db.mediaCache.purge(home.id);
      expect(await db.mediaCache.list(kids.id, home.id, 'row:movies', 'print-1')).toBeUndefined();
    });

    it('keeps other answers beside the lists — a guide, channels — served only for their values', async () => {
      const { db } = open();
      const home = await household(db);
      await db.mediaCache.putValue(alex.id, home.id, 'live:groups', 'print-1', { value: [{ id: 'news', name: 'News' }], savedAt: 5 });
      expect(await db.mediaCache.value(alex.id, home.id, 'live:groups', 'print-1')).toEqual({ value: [{ id: 'news', name: 'News' }], savedAt: 5 });
      expect(await db.mediaCache.value(alex.id, home.id, 'live:groups', 'print-2')).toBeUndefined();
      await db.mediaCache.putValue(alex.id, connectionId('c-gone'), 'live:groups', 'print-1', { value: [], savedAt: 5 });
      expect(await db.mediaCache.value(alex.id, connectionId('c-gone'), 'live:groups', 'print-1')).toBeUndefined();
      await db.mediaCache.purge(home.id);
      expect(await db.mediaCache.value(alex.id, home.id, 'live:groups', 'print-1')).toBeUndefined();
    });

    it('prunes old details and old lists under a prefix, and keeps the rest', async () => {
      const { db } = open();
      const home = await household(db);
      await db.mediaCache.putList(alex.id, home.id, 'children:show-1', 'print-1', savedList(home.id, 1));
      await db.mediaCache.putList(alex.id, home.id, 'children:show-2', 'print-1', savedList(home.id, 100));
      await db.mediaCache.putDetail(alex.id, 'print-1', { detail: detailOf(home.id, 'm2'), savedAt: 100 });
      await db.mediaCache.prune(50, 'children:');
      expect(await db.mediaCache.list(alex.id, home.id, 'children:show-1', 'print-1')).toBeUndefined();
      expect(await db.mediaCache.list(alex.id, home.id, 'children:show-2', 'print-1')).toBeDefined();
      expect(await db.mediaCache.list(alex.id, home.id, 'row:movies', 'print-1')).toBeDefined();
      expect(await db.mediaCache.detail(alex.id, { connectionId: home.id, externalId: 'm1' }, 'print-1')).toBeUndefined();
      expect(await db.mediaCache.detail(alex.id, { connectionId: home.id, externalId: 'm2' }, 'print-1')).toBeDefined();
    });
  });

  describe('watch status and its outbox', () => {
    const key = (id: string, connection = 'c-home') => ({ connectionId: connectionId(connection), externalId: id });
    const played = (id: string, value = true) => ({ kind: 'played' as const, key: key(id), played: value });
    const kinds = async (db: LocalDatabase) => (await db.outbox.list()).map((entry) => `${entry.report.key.externalId} ${entry.report.kind}`);

    it('keeps a profile’s watch state per item, the most recent first', async () => {
      const { db } = open();
      await household(db);
      await db.watchStatus.put(alex.id, { key: key('m1'), status: { played: true }, updatedAt: 1 });
      await db.watchStatus.put(alex.id, { key: key('m2'), status: { played: false, positionMs: 60_000 }, item: movie(connectionId('c-home'), 'm2', 2020), updatedAt: 2 });
      await db.watchStatus.put(alex.id, { key: key('m1'), status: { played: false }, updatedAt: 3 });
      expect((await db.watchStatus.list(alex.id)).map((entry) => [entry.key.externalId, entry.status.played])).toEqual([
        ['m1', false],
        ['m2', false],
      ]);
      expect((await db.watchStatus.get(alex.id, key('m2')))?.item?.title).toBe('m2');
      expect(await db.watchStatus.list(kids.id)).toEqual([]);
    });

    it('queues reports in order, and keeps a long evening short', async () => {
      const { db } = open();
      await household(db);
      const at = (kind: 'started' | 'progress' | 'stopped', positionMs: number, id = 'm1') =>
        kind === 'progress' ? { kind, key: key(id), positionMs, paused: false } : { kind, key: key(id), positionMs };
      await db.outbox.add(alex.id, at('started', 0));
      await db.outbox.add(alex.id, at('progress', 10_000));
      await db.outbox.add(alex.id, at('progress', 20_000, 'm2'));
      await db.outbox.add(alex.id, at('progress', 30_000));
      expect(await kinds(db)).toEqual(['m1 started', 'm2 progress', 'm1 progress']);
      await db.outbox.add(alex.id, at('stopped', 40_000));
      await db.outbox.add(alex.id, played('m1'));
      await db.outbox.add(alex.id, played('m1', false));
      // The newest progress replaced the older, the stop took it along, the last word on watched stands.
      expect(await kinds(db)).toEqual(['m1 started', 'm2 progress', 'm1 stopped', 'm1 played']);
      expect((await db.outbox.list()).at(-1)?.report).toMatchObject({ played: false });
      expect([...(await db.outbox.pendingKeys(alex.id))].sort()).toEqual(['c-home/m1', 'c-home/m2']);
      expect((await db.outbox.pendingKeys(kids.id)).size).toBe(0);
    });

    it('backs an entry off, and removes it once delivered', async () => {
      const { db } = open();
      await household(db);
      await db.outbox.add(alex.id, played('m1'));
      const [entry] = await db.outbox.list();
      if (!entry) throw new Error('nothing queued');
      expect(entry).toMatchObject({ userId: alex.id, attempts: 0 });
      await db.outbox.defer(entry.seq, 2, 5_000);
      expect(await db.outbox.list()).toEqual([{ ...entry, attempts: 2, notBefore: 5_000 }]);
      await db.outbox.remove(entry.seq);
      expect(await db.outbox.list()).toEqual([]);
    });

    it('prunes old watch state only where nothing waits in the outbox', async () => {
      const { db } = open();
      await household(db);
      await db.watchStatus.put(alex.id, { key: key('m1'), status: { played: true }, updatedAt: 1 });
      await db.watchStatus.put(alex.id, { key: key('m2'), status: { played: true }, updatedAt: 1 });
      await db.watchStatus.put(alex.id, { key: key('m3'), status: { played: true }, updatedAt: 9 });
      await db.outbox.add(alex.id, played('m2'));
      await db.watchStatus.prune(5);
      expect((await db.watchStatus.list(alex.id)).map((entry) => entry.key.externalId).sort()).toEqual(['m2', 'm3']);
    });

    it('writes nothing for a profile or a connection that is gone', async () => {
      const { db } = open();
      await household(db);
      await db.watchStatus.put(alex.id, { key: key('m1', 'c-gone'), status: { played: true }, updatedAt: 1 });
      await db.outbox.add(userId('u-gone'), played('m1'));
      await db.outbox.add(alex.id, { kind: 'played', key: key('m1', 'c-gone'), played: true });
      expect(await db.watchStatus.list(alex.id)).toEqual([]);
      expect(await db.outbox.list()).toEqual([]);
    });

    it('go with their profile, and with their connection', async () => {
      const { db } = open();
      const home = await household(db);
      await db.connections.insert(connection('c-other'));
      for (const user of [alex.id, kids.id]) {
        await db.watchStatus.put(user, { key: key('m1'), status: { played: true }, updatedAt: 1 });
        await db.outbox.add(user, played('m1'));
      }
      await db.watchStatus.put(alex.id, { key: key('m1', 'c-other'), status: { played: true }, updatedAt: 1 });
      await db.outbox.add(alex.id, { kind: 'played', key: key('m1', 'c-other'), played: true });
      await db.users.delete(kids.id);
      expect((await db.outbox.list()).map((entry) => entry.userId)).toEqual([alex.id, alex.id]);
      await db.connections.delete(home.id);
      expect((await db.outbox.list()).map((entry) => entry.report.key.connectionId)).toEqual(['c-other']);
      expect((await db.watchStatus.list(alex.id)).map((entry) => entry.key.connectionId)).toEqual(['c-other']);
      await db.outbox.clear();
      expect(await db.outbox.list()).toEqual([]);
    });

    it('is never journaled', async () => {
      const { db } = open();
      await household(db);
      const head = await db.journal.head();
      await db.watchStatus.put(alex.id, { key: key('m1'), status: { played: true }, updatedAt: 1 });
      await db.outbox.add(alex.id, played('m1'));
      expect(await db.journal.head()).toBe(head);
    });
  });

  describe('stale secrets', () => {
    it('are queued once each, and removed when deleted', async () => {
      const { db } = open();
      await db.staleSecrets.add([credentialsRef('a'), credentialsRef('b')]);
      await db.staleSecrets.add([credentialsRef('a')]);
      expect([...(await db.staleSecrets.list())].sort()).toEqual(['a', 'b']);
      await db.staleSecrets.remove([credentialsRef('a')]);
      expect(await db.staleSecrets.list()).toEqual(['b']);
    });
  });

  it('keeps everything when the database is opened again', async () => {
    const where = reopenable(engine);
    const first = open(where);
    const home = await household(first.db);
    await first.db.deviceSettings.update((current) => ({ ...current, defaultUserId: alex.id }));

    const again = open(where).db;
    expect((await again.users.list()).map((user) => user.id)).toEqual([kids.id, alex.id]);
    expect((await again.connections.profileValues(home.id)).get(alex.id)).toEqual(ownValues);
    expect((await again.deviceSettings.get()).defaultUserId).toBe(alex.id);
    expect((await again.journal.entries()).length).toBeGreaterThan(0);
  });
});

