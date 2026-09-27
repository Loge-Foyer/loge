import { AppError, connectionId, pluginId, syncCursor, userId, type SyncChange } from '@sc/api';
import { describe, expect, it } from 'vitest';

import { draftOf } from '@/services/connection-draft';
import { applyPage } from '@/services/sync/apply';

import { ENGINE_PAIRS, mediaDraft, signIn, sync, twoDevices, type Device } from './support/devices';
import { dumpDatabase, reopenable } from './support/engines';
import { silentLog } from './support/fakes';
import { buildServices, fakeMediaPlugin } from './support/services';
import { fakeSyncAccount } from './support/sync';

const NEWEST = { by: 'releaseDate', order: 'desc' } as const;
const layout = { version: 1 as const, rows: [{ id: 'continue', type: 'continue' as const, hidden: true }] };

async function nameOf(device: Device, id: ReturnType<typeof userId>) {
  return (await device.services.profiles.get(id))?.name;
}

describe.each(ENGINE_PAIRS)('two devices on %s and %s', (first, second) => {
  /** A made Alex, signed in, and B joined the account: both hold Alex. */
  async function joined() {
    const devices = twoDevices([first, second]);
    const alex = (await devices.a.services.profiles.create('Alex')).id;
    await signIn(devices.a, devices.account);
    await signIn(devices.b, devices.account);
    return { ...devices, alex };
  }

  describe('what reaches the other device', () => {
    it('brings a profile, its layout and its PIN — the PIN into the keychain, never the database', async () => {
      const { a, b, alex } = await joined();
      expect(await nameOf(b, alex)).toBe('Alex');

      await a.services.homeLayout.update(alex, () => layout.rows);
      await a.services.pins.create(alex, '1234');
      await sync(a);
      await sync(b);

      expect(await b.services.homeLayout.rows(alex)).toEqual(layout.rows);
      expect(await b.services.pins.verify(alex, '1234')).toEqual({ ok: true });
      expect((await b.services.pins.verify(alex, '9999')).ok).toBe(false);
      expect(await dumpDatabase(second, b.where)).not.toContain('1234');
    });

    it('lets a device that joins with nothing see the account’s profiles', async () => {
      const { a, b, account } = twoDevices([first, second]);
      await a.services.profiles.create('Alex');
      await a.services.profiles.create('Kids');
      await signIn(a, account);
      const { profilesArrived } = await signIn(b, account);
      expect(profilesArrived).toBe(2);
      expect((await b.services.profiles.list()).map((profile) => profile.name).sort()).toEqual(['Alex', 'Kids']);
    });

    it('writes nothing it applied into the journal, so nothing comes back for ever', async () => {
      const { a, b, alex, account } = await joined();
      const before = (await b.db.journal.entries()).length;
      await a.services.profiles.rename(alex, 'Alexandra');
      await sync(a);
      await sync(b);
      expect(await nameOf(b, alex)).toBe('Alexandra');
      expect(await b.db.journal.entries()).toHaveLength(before);
      const logged = account.log.length;
      await sync(a);
      await sync(b);
      expect(account.log).toHaveLength(logged);
    });
  });

  describe('pushing', () => {
    it('counts a change as waiting as soon as it is made, and as sent once it went', async () => {
      const { a, alex } = await joined();
      await sync(a);
      expect(a.engine.status()).toMatchObject({ phase: 'synced', pending: 0 });
      await a.services.profiles.rename(alex, 'Renamed');
      await a.engine.changed();
      expect(a.engine.status()).toMatchObject({ phase: 'synced', pending: 1 });
      await sync(a);
      expect(a.engine.status()).toMatchObject({ phase: 'synced', pending: 0 });
    });

    it('sends again only what the account did not store', async () => {
      const { a, account, alex } = await joined();
      await a.services.profiles.rename(alex, 'One');
      await a.services.homeLayout.update(alex, () => layout.rows);
      account.acceptOnly(1);
      await sync(a);
      expect(a.engine.status().phase).toBe('waiting');
      await sync(a);
      expect(a.engine.status().phase).toBe('synced');
      const ids = account.log.map((change) => change.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('converges after an answer lost on the way back', async () => {
      const { a, b, account, alex } = await joined();
      await a.services.profiles.rename(alex, 'From A');
      account.loseNextAnswer();
      await sync(a);
      expect(a.engine.status().phase).toBe('waiting');
      await b.services.profiles.rename(alex, 'From B');
      await sync(b);
      await sync(a);
      await sync(b);
      expect(await nameOf(a, alex)).toBe('From B');
      expect(await nameOf(b, alex)).toBe('From B');
    });

    it('sends nothing on a second run with nothing new', async () => {
      const { a, account } = await joined();
      await sync(a);
      const pushes = account.calls.pushes;
      await sync(a);
      expect(account.calls.pushes).toBe(pushes);
    });
  });

  describe('conflicts', () => {
    it('converge on the account’s order', async () => {
      const { a, b, alex } = await joined();
      await a.services.profiles.rename(alex, 'A');
      await b.services.profiles.rename(alex, 'B');
      await sync(a);
      await sync(b);
      await sync(a);
      await sync(b);
      expect(await nameOf(a, alex)).toBe('B');
      expect(await nameOf(b, alex)).toBe('B');
    });

    it('never let an older change undo one this device sent and has not seen come back', async () => {
      const { a, account, media, alex } = await joined();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      const edit = await a.services.connections.edit(home.id);
      if (!edit) throw new Error('setup');
      await a.services.connections.update(home.id, { ...draftOf(media.manifest, edit), label: 'Home' });
      await sync(a);
      const mine = account.log.at(-1);
      // Another device removed the password — and its change landed before ours.
      account.inject(
        {
          id: 'elsewhere-1',
          changedAt: 1,
          entity: 'connection',
          operation: 'upsert',
          data: {
            connectionId: home.id,
            pluginId: media.manifest.id,
            label: 'Old',
            media: true,
            perProfile: 'none',
            fields: { serverUrl: 'http://home:8096', username: 'family' },
            settings: {},
            secretKeys: [],
          },
        },
        mine?.id,
      );
      await sync(a);
      const kept = await a.services.connections.edit(home.id);
      expect(kept?.connection.label).toBe('Home');
      expect(kept?.saved.shared.has('password')).toBe(true);
    });

    it('keep a PIN set on one device when the other renames the profile', async () => {
      const { a, b, alex } = await joined();
      await a.services.profiles.rename(alex, 'Alexandra');
      await b.services.pins.create(alex, '4321');
      await sync(b);
      await sync(a);
      await sync(b);
      expect(await nameOf(b, alex)).toBe('Alexandra');
      expect(await a.services.pins.verify(alex, '4321')).toEqual({ ok: true });
      expect(await b.services.pins.verify(alex, '4321')).toEqual({ ok: true });
    });

    it('let a profile deleted elsewhere go, even while this device was changing it', async () => {
      const { a, b, alex } = await joined();
      await a.services.profiles.create('Kids');
      await sync(a);
      await sync(b);
      await b.services.homeLayout.update(alex, () => layout.rows);
      await a.services.profiles.remove(alex);
      await sync(a);
      await sync(b);
      expect(await b.services.profiles.get(alex)).toBeUndefined();
      await sync(a);
      expect(await a.services.profiles.get(alex)).toBeUndefined();
    });

    it('take even the last profile, and send the device back to the start', async () => {
      const { a, b, account } = twoDevices([first, second]);
      const one = (await a.services.profiles.create('One')).id;
      await signIn(a, account);
      const two = (await b.services.profiles.create('Two')).id;
      await signIn(b, account, 'both');
      await sync(a);
      await a.services.session.start();
      await b.services.session.start();
      // Each device deletes the profile the other brought, keeping one of its own.
      await a.services.profiles.remove(two);
      await b.services.profiles.remove(one);
      await sync(a);
      await sync(b);
      await sync(a);
      expect(await a.services.profiles.list()).toEqual([]);
      expect(await b.services.profiles.list()).toEqual([]);
      expect(a.services.session.getSnapshot().kind).toBe('needs-first-user');
      expect(b.services.session.getSnapshot().kind).toBe('needs-first-user');
    });
  });

  describe('changes that cannot all apply', () => {
    it('find a parent that arrived earlier on the same page, and leave out what they do not understand', async () => {
      const { a, account } = twoDevices([first, second]);
      await signIn(a, account);
      const sam = userId('u-sam');
      account.inject({ id: 'x1', changedAt: 1, entity: 'profile', operation: 'upsert', data: { userId: sam, name: 'Sam' } });
      account.inject({ id: 'x2', changedAt: 1, entity: 'watchProgress', operation: 'upsert' } as unknown as SyncChange);
      account.inject({ id: 'x3', changedAt: 1, entity: 'preferences', operation: 'upsert', data: { userId: sam, key: 'homeLayout', value: layout } });
      account.inject({ id: 'x4', changedAt: 1, entity: 'preferences', operation: 'upsert', data: { userId: userId('u-gone'), key: 'homeLayout', value: layout } });
      await sync(a);
      expect(a.engine.status().phase).toBe('synced');
      expect(await a.services.profiles.get(sam)).toMatchObject({ name: 'Sam' });
      expect(await a.services.homeLayout.rows(sam)).toEqual(layout.rows);
      expect(await a.services.profiles.get(userId('u-gone'))).toBeUndefined();
    });
  });

  describe('passwords', () => {
    it('stay on the other device when this one edits a connection it has no password for', async () => {
      const { a, b, media, alex } = await joined();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      await sync(b);
      const onB = await b.services.connections.edit(home.id);
      if (!onB) throw new Error('the connection did not arrive');
      expect(onB.connection.values.secretKeys).toEqual(['password']);
      expect(onB.saved.shared.has('password')).toBe(false);
      await b.services.connections.update(home.id, { ...draftOf(media.manifest, onB), label: 'Renamed on B' });
      await sync(b);
      await sync(a);
      const onA = await a.services.connections.edit(home.id);
      expect(onA?.connection.label).toBe('Renamed on B');
      expect(onA?.saved.shared.has('password')).toBe(true);
    });

    it('are asked for on a device that has none, and nothing signs in without one', async () => {
      const { a, b, media, alex } = await joined();
      await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      await sync(b);
      const result = await b.services.media.row(alex, { kind: 'movies', sort: NEWEST }, 10);
      expect(result.sourceErrors).toMatchObject([{ needsPassword: true }]);
      expect(media.stats.signedInWith.filter((secrets) => secrets.password === undefined)).toEqual([]);
    });

    it('never travel, and an unreadable PIN is not sent at all', async () => {
      const { a, account, media, alex } = await joined();
      await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await a.services.pins.create(alex, '1357');
      await sync(a);
      expect(JSON.stringify(account.log)).not.toContain('family-secret');
      expect(JSON.stringify(account.log)).toContain('1357');

      // A restore lost the keychain entry of a PIN that then changed.
      await a.services.pins.change(alex, '1357', '2468');
      const ref = (await a.db.users.get(alex))?.pinCredentialRef;
      if (ref) await a.credentials.delete(ref);
      await sync(a);
      expect(JSON.stringify(account.log)).not.toContain('2468');
      expect(account.log.filter((change) => change.entity === 'pin').at(-1)).toMatchObject({ data: { pin: '1357' } });
    });
  });

  describe('what never travels', () => {
    it('keeps the account’s own connection off the account, and never lets a sync role arrive', async () => {
      const { a, b, account, media, alex } = await joined();
      await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      await sync(b);
      const accountOnA = (await a.services.account.current())?.connection.id;
      expect(account.log.some((change) => change.entity === 'connection' && change.operation === 'upsert' && change.data.connectionId === accountOnA)).toBe(false);
      const onB = await b.db.connections.list();
      expect(onB.filter((connection) => connection.roles.sync === true)).toHaveLength(1);
    });

    it('keeps a connection of a plugin this build does not know, and never sends it', async () => {
      const { a, account } = await joined();
      await a.db.connections.insert({
        id: connectionId('c-ghost'),
        pluginId: pluginId('ghost'),
        label: 'Ghost',
        roles: { media: true },
        perProfile: 'none',
        values: { fields: {}, settings: {} },
      });
      await sync(a);
      expect(account.log.some((change) => change.entity === 'connection' && change.operation === 'upsert' && change.data.pluginId === 'ghost')).toBe(false);
      expect(await a.db.connections.get(connectionId('c-ghost'))).toBeDefined();
    });

    it('installs the plugin of a connection new to this device', async () => {
      const { a, b, media, alex } = await joined();
      await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      expect((await b.services.devicePlugins.states())[media.manifest.id]?.enabled).not.toBe(true);
      await sync(b);
      expect((await b.services.devicePlugins.states())[media.manifest.id]).toEqual({ enabled: true });
    });

    it('purges no saved media for its own echo', async () => {
      const { a, media, alex } = await joined();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      await a.db.mediaCache.putList(alex, home.id, 'row:movies', 'print', { items: [], savedAt: 1 });
      await sync(a);
      expect(await a.db.mediaCache.list(alex, home.id, 'row:movies', 'print')).toBeDefined();
    });
  });

  describe('an account that lost its place', () => {
    it('is joined again after a reset, keeping newer values and pending deletes', async () => {
      const { a, account, alex } = await joined();
      const kids = (await a.services.profiles.create('Kids')).id;
      await sync(a);
      account.reset();
      await a.services.profiles.rename(alex, 'Newer');
      await a.services.profiles.remove(kids);
      await sync(a);
      expect(a.engine.status().phase).toBe('synced');
      expect(await nameOf(a, alex)).toBe('Newer');
      const upserts = account.log.filter((change) => change.entity === 'profile' && change.operation === 'upsert');
      expect(upserts.at(-1)).toMatchObject({ data: { name: 'Newer' } });
      expect(account.log.some((change) => change.entity === 'profile' && change.operation === 'delete' && change.target.userId === kids)).toBe(true);
    });

    it('is joined again after a rewind, the values here winning', async () => {
      const { a, account, alex } = await joined();
      await a.services.profiles.rename(alex, 'Kept');
      await sync(a);
      account.rewind(1);
      await sync(a);
      expect(await nameOf(a, alex)).toBe('Kept');
      expect(account.log.filter((change) => change.entity === 'profile').at(-1)).toMatchObject({ data: { name: 'Kept' } });
    });

    it('is read again from the start after its cursor expired, sending nothing extra', async () => {
      const { a, account } = await joined();
      const entries = (await a.db.journal.entries()).length;
      account.expireNext();
      await sync(a);
      expect(a.engine.status().phase).toBe('synced');
      expect(await a.db.journal.entries()).toHaveLength(entries);
    });

    it('is joined again for what it newly carries, after an update of the app', async () => {
      const account = fakeSyncAccount();
      const media = fakeMediaPlugin('fake');
      // Another device, carrying everything, put a layout in the account.
      const full = buildServices({ plugins: [account.plugin, media.plugin], engine: first, device: 'full' });
      const alex = (await full.services.profiles.create('Alex')).id;
      await full.services.homeLayout.update(alex, () => layout.rows);
      await signIn(full, account);

      // This device's build carries profiles only.
      const where = reopenable(second);
      const older = buildServices({ plugins: [account.pluginCarrying(['profile']), media.plugin], engine: second, device: 'b', where });
      await signIn(older, account);
      expect(await nameOf(older as Device, alex)).toBe('Alex');
      expect((await older.db.preferences.get(alex)).homeLayout).toBeUndefined();

      // The update: the same database and keychain, and a plugin that carries preferences too.
      const newer = buildServices({
        plugins: [account.plugin, media.plugin],
        engine: second,
        device: 'b',
        where,
        credentials: older.credentials,
        deviceBound: older.deviceBound,
      });
      await sync(newer);
      expect(newer.engine.status().phase).toBe('synced');
      expect(await newer.services.homeLayout.rows(alex)).toEqual(layout.rows);
    });

    it('sends what changed while a kind was switched off, once it is carried again', async () => {
      const account = fakeSyncAccount({ toggle: 'preferences' });
      const device = buildServices({ plugins: [account.plugin], engine: first, device: 'a' });
      const alex = (await device.services.profiles.create('Alex')).id;
      await signIn(device, account);
      const carrying = async (on: boolean) => {
        const current = await device.services.account.current();
        const edit = current && (await device.services.connections.edit(current.connection.id));
        if (!edit) throw new Error('setup');
        const draft = draftOf(account.plugin.manifest, edit);
        await device.services.connections.update(edit.connection.id, { ...draft, shared: { ...draft.shared, settings: { carry: on } } });
        await sync(device);
      };

      await carrying(false);
      // Not carried now: it goes nowhere, and the journal moves past it.
      await device.services.homeLayout.update(alex, () => layout.rows);
      await sync(device);
      const layouts = () => account.log.filter((change) => change.entity === 'preferences');
      expect(layouts()).toEqual([]);

      await carrying(true);
      expect(layouts()).toMatchObject([{ operation: 'upsert', data: { userId: alex, key: 'homeLayout', value: layout } }]);
    });
  });

  it('drops a page pulled from a cursor another run — another tab — has since moved', async () => {
    const { a, alex } = await joined();
    const current = await a.services.account.current();
    if (!current) throw new Error('setup');
    const parts = { db: a.db, credentials: a.credentials, catalog: a.services.catalog, ids: { next: () => 'x' }, janitor: a.janitor, log: silentLog };
    const stale = await applyPage(
      parts,
      current.connection,
      current.carried,
      syncCursor('a-cursor-from-before'),
      [{ id: 'y1', changedAt: 1, entity: 'profile', operation: 'upsert', data: { userId: alex, name: 'Stale' } }],
      syncCursor('after'),
    );
    expect(stale).toBe('moved');
    expect(await nameOf(a, alex)).toBe('Alex');
  });

  it('fails loudly on a push the account refuses to take', async () => {
    const { a, account, alex } = await joined();
    await a.services.profiles.rename(alex, 'Changed');
    account.failNext(new AppError('PROVIDER_UNAVAILABLE', 'Down for maintenance.', { retry: 'backoff' }));
    await sync(a);
    expect(a.engine.status()).toMatchObject({ phase: 'waiting', problem: { code: 'PROVIDER_UNAVAILABLE', retry: 'backoff' } });
    expect(a.engine.status().pending).toBeGreaterThan(0);
    await sync(a);
    expect(a.engine.status()).toMatchObject({ phase: 'synced', pending: 0 });
  });
});
