import {
  AppError,
  connectionId,
  pluginId,
  syncCursor,
  userId,
  type ConnectionId,
  type FieldValues,
  type SyncChange,
  type UserId,
} from '@sc/api';
import { describe, expect, it } from 'vitest';

import { draftOf, initialDraft, setSecret, setValue } from '@/services/connection-draft';
import type { ConnectionDraft, ProfileDraft } from '@/services/connections';
import { applyPage } from '@/services/sync/apply';
import { openVault, sealPassword, signInOf } from '@/services/sync/sealed';

import { testCrypto } from './support/crypto';
import { ENGINE_PAIRS, mediaDraft, signIn, sync, twoDevices, type Device } from './support/devices';
import { dumpDatabase, reopenable, type Engine } from './support/engines';
import { silentLog } from './support/fakes';
import { buildServices, fakeMediaPlugin, type FakeSourceOptions } from './support/services';
import { fakeSyncAccount, SEALING, type FakeAccount } from './support/sync';

const NEWEST = { by: 'releaseDate', order: 'desc' } as const;
const layout = { version: 1 as const, rows: [{ id: 'continue', type: 'continue' as const, hidden: true }] };

async function nameOf(device: Device, id: ReturnType<typeof userId>) {
  return (await device.services.profiles.get(id))?.name;
}

type Media = ReturnType<typeof fakeMediaPlugin>;

/** The password a device has saved for a connection — everyone's, or one profile's own. */
async function savedPassword(device: Pick<Device, 'db' | 'credentials'>, id: ConnectionId, profile?: UserId) {
  const values = profile ? (await device.db.connections.profileValues(id)).get(profile) : (await device.db.connections.get(id))?.values;
  return values?.credentialsRef ? (await device.credentials.read(values.credentialsRef))?.password : undefined;
}

/** A password sealed the way a device signed in to `account` seals it, for the sign-in `fields` describe. */
async function sealFor(account: FakeAccount, media: Media, key: string, password: string, fields: FieldValues) {
  const crypto = testCrypto();
  const vault = await openVault(crypto, account.vaultKey);
  const value = await sealPassword(crypto, vault, key, 'password', password, signInOf(media.manifest.id, media.manifest, fields));
  if (!value) throw new Error('setup');
  return value;
}

/** A connection as another device sends it. */
function connectionChange(media: Media, id: string, fields: FieldValues, sealed?: Readonly<Record<string, string>>): SyncChange {
  return {
    id: `sent-${id}`,
    changedAt: 1,
    entity: 'connection',
    operation: 'upsert',
    data: {
      connectionId: connectionId(id),
      pluginId: media.manifest.id,
      label: id,
      media: true,
      perProfile: 'none',
      fields,
      settings: {},
      secretKeys: ['password'],
      ...(sealed ? { sealed } : {}),
    },
  };
}

/** The first change the account holds for a connection. */
function sentFor(account: FakeAccount, id: ConnectionId) {
  const change = account.log.find((candidate) => candidate.entity === 'connection' && candidate.operation === 'upsert' && candidate.data.connectionId === id);
  if (change?.entity !== 'connection' || change.operation !== 'upsert') throw new Error('setup');
  return change;
}

/** A connection each profile signs in to with a username and password of its own. */
function perProfileDraft(media: Media, logins: Readonly<Partial<Record<UserId, readonly [string, string]>>>): ConnectionDraft {
  const draft = initialDraft(media.manifest, 0);
  const profiles: Partial<Record<UserId, ProfileDraft>> = {};
  for (const [id, login] of Object.entries(logins) as [UserId, readonly [string, string] | undefined][]) {
    if (login) profiles[id] = { fields: { username: login[0] }, settings: {}, secrets: { password: login[1] } };
  }
  return { ...draft, perProfile: 'credentials', shared: { ...draft.shared, fields: { ...draft.shared.fields, serverUrl: 'http://home:8096' } }, profiles };
}

async function setPassword(device: Device, media: Media, id: ConnectionId, tab: UserId, password: string) {
  const edit = await device.services.connections.edit(id);
  if (!edit) throw new Error('setup');
  await device.services.connections.update(id, setSecret(draftOf(media.manifest, edit), tab, 'password', password));
}

async function setField(device: Device, media: Media, id: ConnectionId, tab: UserId, key: string, value: string) {
  const edit = await device.services.connections.edit(id);
  if (!edit) throw new Error('setup');
  await device.services.connections.update(id, setValue(media.manifest, draftOf(media.manifest, edit), tab, 'fields', key, value));
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

    it('leave out a change whose id came earlier on the same page', async () => {
      const { b, account, alex } = await joined();
      account.inject({ id: 'twice', changedAt: 1, entity: 'profile', operation: 'upsert', data: { userId: alex, name: 'First' } });
      account.inject({ id: 'twice', changedAt: 2, entity: 'profile', operation: 'upsert', data: { userId: alex, name: 'Second' } });
      await sync(b);
      expect(await nameOf(b, alex)).toBe('First');
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

    it('never follow a connection somewhere else: the other device asks instead', async () => {
      const { a, b, media, alex } = await joined();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      await sync(b);
      // B's own copy, typed in on B.
      await setPassword(b, media, home.id, alex, 'family-secret');
      await sync(b);
      await setField(a, media, home.id, alex, 'serverUrl', 'http://elsewhere:8096');
      await sync(a);
      await sync(b);
      expect(await savedPassword(b, home.id)).toBeUndefined();
      expect(await savedPassword(a, home.id)).toBe('family-secret');
      const result = await b.services.media.row(alex, { kind: 'movies', sort: NEWEST }, 10);
      expect(result.sourceErrors).toMatchObject([{ needsPassword: true }]);
      expect(media.stats.signedInAt.filter((at) => at.includes('elsewhere'))).toEqual([]);
    });
  });

  describe('passwords, on an account that seals them', () => {
    /** As `joined`, on an account that carries passwords sealed. */
    async function sealing(media: FakeSourceOptions = {}) {
      const devices = twoDevices([first, second], { account: { carries: SEALING }, media });
      const alex = (await devices.a.services.profiles.create('Alex')).id;
      await signIn(devices.a, devices.account);
      await signIn(devices.b, devices.account);
      return { ...devices, alex };
    }

    it('reach the other device sealed: into its keychain, never its database or the account', async () => {
      const { a, b, account, media, alex } = await sealing();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      await sync(b);
      expect(await savedPassword(b, home.id)).toBe('family-secret');
      expect(await dumpDatabase(second, b.where)).not.toContain('family-secret');
      expect(JSON.stringify(account.log)).not.toContain('family-secret');
      expect(sentFor(account, home.id).data.sealed?.password).toMatch(/^v1\./);
      const result = await b.services.media.row(alex, { kind: 'movies', sort: NEWEST }, 10);
      expect(result.sourceErrors).toEqual([]);
      expect(media.stats.signedInWith).toEqual([{ password: 'family-secret' }]);
    });

    it('arrive with the sign-in itself: the join opens them', async () => {
      const { a, b, account, media } = twoDevices([first, second], { account: { carries: SEALING } });
      const alex = (await a.services.profiles.create('Alex')).id;
      await signIn(a, account);
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      await signIn(b, account);
      expect(await savedPassword(b, home.id)).toBe('family-secret');
    });

    it('reach each profile on the other device, when each signs in on its own', async () => {
      const { a, b, media, alex } = await sealing();
      const kids = (await a.services.profiles.create('Kids')).id;
      const draft = perProfileDraft(media, { [alex]: ['alex', 'alex-secret'], [kids]: ['kids', 'kids-secret'] });
      const home = await a.services.connections.create(media.manifest.id, draft);
      await sync(a);
      await sync(b);
      expect(await savedPassword(b, home.id, alex)).toBe('alex-secret');
      expect(await savedPassword(b, home.id, kids)).toBe('kids-secret');
      const dump = await dumpDatabase(second, b.where);
      expect(dump).not.toContain('alex-secret');
      expect(dump).not.toContain('kids-secret');
    });

    it('travel as names only when this device cannot read its own', async () => {
      const { a, b, account, media, alex } = await sealing();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      const ref = (await a.db.connections.get(home.id))?.values.credentialsRef;
      if (!ref) throw new Error('setup');
      await a.credentials.delete(ref);
      await sync(a);
      expect(sentFor(account, home.id).data).toMatchObject({ secretKeys: ['password'] });
      expect(sentFor(account, home.id).data.sealed).toBeUndefined();
      await sync(b);
      expect((await b.db.connections.get(home.id))?.values.secretKeys).toEqual(['password']);
      expect(await savedPassword(b, home.id)).toBeUndefined();
    });

    it('replace the other device’s when changed, while a device’s own echo takes nothing new', async () => {
      const { a, b, media, alex } = await sealing();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      await sync(b);
      await setPassword(a, media, home.id, alex, 'changed-secret');
      const ref = (await a.db.connections.get(home.id))?.values.credentialsRef;
      await a.db.mediaCache.putList(alex, home.id, 'row:movies', 'print', { items: [], savedAt: 1 });
      await sync(a);
      await sync(a);
      expect((await a.db.connections.get(home.id))?.values.credentialsRef).toBe(ref);
      expect(await a.db.mediaCache.list(alex, home.id, 'row:movies', 'print')).toBeDefined();
      await sync(b);
      expect(await savedPassword(b, home.id)).toBe('changed-secret');
    });

    it('land on the last of several changes on one page, for a password and for a PIN', async () => {
      const { a, b, account, media, alex } = await sealing();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await a.services.pins.create(alex, '1111');
      await sync(a);
      await sync(b);
      const connection = sentFor(account, home.id);
      const pin = [...account.log].reverse().find((change) => change.entity === 'pin' && change.operation === 'upsert' && change.data.pin === '1111');
      if (!pin) throw new Error('setup');
      await setPassword(a, media, home.id, alex, 'second-secret');
      await a.services.pins.change(alex, '1111', '2222');
      await sync(a);
      // Another device went back to what B holds now, and its changes land after A's on the same page.
      account.inject({ ...connection, id: 'back-1' });
      account.inject({ ...pin, id: 'back-2' });
      await sync(b);
      expect(await savedPassword(b, home.id)).toBe('family-secret');
      expect(await b.services.pins.verify(alex, '1111')).toEqual({ ok: true });
    });

    it('make the other device ask for a seal it cannot open — tampered, of a later version, or made for another connection', async () => {
      const { b, account, media, alex } = await sealing();
      const fields = { serverUrl: 'http://home:8096', username: 'family' };
      const good = await sealFor(account, media, 'connection/c-1', 'family-secret', fields);
      const [version, kid, body = ''] = good.split('.');
      account.inject(connectionChange(media, 'c-1', fields, { password: `${version}.${kid}.${body.startsWith('A') ? 'B' : 'A'}${body.slice(1)}` }));
      account.inject(connectionChange(media, 'c-2', fields, { password: `v2.${kid}.${body}` }));
      account.inject(connectionChange(media, 'c-3', fields, { password: good }));
      await sync(b);
      expect(b.engine.status().phase).toBe('synced');
      for (const id of ['c-1', 'c-2', 'c-3']) {
        const onB = await b.services.connections.edit(connectionId(id));
        expect(onB?.connection.values.secretKeys).toEqual(['password']);
        expect(onB?.saved.shared.has('password')).toBe(false);
      }
      const result = await b.services.media.row(alex, { kind: 'movies', sort: NEWEST }, 10);
      expect(result.sourceErrors).toHaveLength(3);
      expect(result.sourceErrors.every((error) => error.needsPassword === true)).toBe(true);
      expect(media.stats.signedInWith).toEqual([]);
    });

    it('stop a run whose key cannot be had before the page that needed it, the cursor where it was', async () => {
      const { a, b, account, media, alex } = await sealing();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      const accountId = (await b.services.account.current())?.connection.id;
      if (!accountId) throw new Error('setup');
      const before = (await b.db.syncState.get(accountId))?.cursor;
      account.failVaultKey(new AppError('PROVIDER_UNAVAILABLE', 'The key is out of reach.', { retry: 'backoff' }));
      await sync(b);
      expect(b.engine.status()).toMatchObject({ phase: 'waiting', problem: { code: 'PROVIDER_UNAVAILABLE' } });
      expect(await b.db.connections.get(home.id)).toBeUndefined();
      expect((await b.db.syncState.get(accountId))?.cursor).toBe(before);
      account.failVaultKey(undefined);
      await sync(b);
      expect(await savedPassword(b, home.id)).toBe('family-secret');
    });

    it.each([
      ['address', { serverUrl: 'http://elsewhere:8096', username: 'family' }],
      ['username', { serverUrl: 'http://home:8096', username: 'someone-else' }],
    ])('are dropped and asked for when the account points them at another %s — nothing signs in there', async (_what, fields) => {
      const { a, b, account, media, alex } = await sealing();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      await sync(b);
      const sent = sentFor(account, home.id);
      // The old seal sent on somewhere else: whoever holds the account can do that, though not read it.
      account.inject({ ...sent, id: 'redirected', data: { ...sent.data, fields } });
      await sync(b);
      expect((await b.db.connections.get(home.id))?.values.fields).toEqual(fields);
      expect(await savedPassword(b, home.id)).toBeUndefined();
      const result = await b.services.media.row(alex, { kind: 'movies', sort: NEWEST }, 10);
      expect(result.sourceErrors).toMatchObject([{ needsPassword: true }]);
      expect(media.stats.signedInWith).toEqual([]);
    });

    it('are dropped when the account hands a connection to another plugin', async () => {
      const other = fakeMediaPlugin('other', { signsIn: true });
      const { a, b, account, media } = twoDevices([first, second], { account: { carries: SEALING }, extra: [other.plugin] });
      const alex = (await a.services.profiles.create('Alex')).id;
      await signIn(a, account);
      await signIn(b, account);
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      await sync(b);
      const sent = sentFor(account, home.id);
      account.inject({ ...sent, id: 'handed-over', data: { ...sent.data, pluginId: other.manifest.id } });
      await sync(b);
      expect((await b.db.connections.get(home.id))?.pluginId).toBe(other.manifest.id);
      expect(await savedPassword(b, home.id)).toBeUndefined();
    });

    it('follow a move made on the other device, each profile’s included', async () => {
      const { a, b, media, alex } = await sealing();
      const kids = (await a.services.profiles.create('Kids')).id;
      const draft = perProfileDraft(media, { [alex]: ['alex', 'alex-secret'], [kids]: ['kids', 'kids-secret'] });
      const home = await a.services.connections.create(media.manifest.id, draft);
      await sync(a);
      await sync(b);
      await setField(a, media, home.id, alex, 'serverUrl', 'http://new-home:8096');
      await sync(a);
      await sync(b);
      expect((await b.db.connections.get(home.id))?.values.fields.serverUrl).toBe('http://new-home:8096');
      expect(await savedPassword(b, home.id, alex)).toBe('alex-secret');
      expect(await savedPassword(b, home.id, kids)).toBe('kids-secret');
    });

    it('go from every profile when the account points their connection somewhere else, and each asks', async () => {
      const { a, b, account, media, alex } = await sealing();
      const kids = (await a.services.profiles.create('Kids')).id;
      const draft = perProfileDraft(media, { [alex]: ['alex', 'alex-secret'], [kids]: ['kids', 'kids-secret'] });
      const home = await a.services.connections.create(media.manifest.id, draft);
      await sync(a);
      await sync(b);
      const sent = sentFor(account, home.id);
      account.inject({ ...sent, id: 'redirected', data: { ...sent.data, fields: { serverUrl: 'http://elsewhere:8096' } } });
      await sync(b);
      for (const profile of [alex, kids]) {
        expect(await savedPassword(b, home.id, profile)).toBeUndefined();
        expect((await b.db.connections.profileValues(home.id)).get(profile)?.secretKeys).toEqual(['password']);
      }
      expect(media.stats.signedInWith).toEqual([]);
    });

    it('stay as they are when the other device changes something that is not where or as whom it signs in', async () => {
      const { a, b, media, alex } = await sealing({ withNote: true });
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      await sync(b);
      const ref = (await b.db.connections.get(home.id))?.values.credentialsRef;
      expect(ref).toBeDefined();
      await setField(a, media, home.id, alex, 'note', 'upstairs');
      await sync(a);
      await sync(b);
      const onB = await b.db.connections.get(home.id);
      expect(onB?.values.fields.note).toBe('upstairs');
      expect(onB?.values.credentialsRef).toBe(ref);
    });

    it('fill in one a device lacks, even while its own change to that connection waits', async () => {
      const { a, b, media, alex } = await sealing();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      await sync(b);
      // A restore lost B's copy, and B renamed the connection before it synced again.
      const lost = (await b.db.connections.get(home.id))?.values.credentialsRef;
      if (!lost) throw new Error('setup');
      await b.credentials.delete(lost);
      const onB = await b.services.connections.edit(home.id);
      if (!onB) throw new Error('setup');
      await b.services.connections.update(home.id, { ...draftOf(media.manifest, onB), label: 'Named on B' });
      const onA = await a.services.connections.edit(home.id);
      if (!onA) throw new Error('setup');
      await a.services.connections.update(home.id, { ...draftOf(media.manifest, onA), label: 'Named on A' });
      await sync(a);
      await sync(b);
      // B's change is later in the log, and wins; the password comes in all the same.
      expect((await b.db.connections.get(home.id))?.label).toBe('Named on B');
      expect(await savedPassword(b, home.id)).toBe('family-secret');
      await sync(a);
      expect((await a.db.connections.get(home.id))?.label).toBe('Named on B');
      expect(await savedPassword(a, home.id)).toBe('family-secret');
    });

    it.each([
      ['A', 'B'],
      ['B', 'A'],
    ] as const)('spread to every device once the account carries them, %s running first', async (one, other) => {
      const account = fakeSyncAccount();
      const media = fakeMediaPlugin('fake', { signsIn: true });
      const before = { A: reopenable(first), B: reopenable(second) };
      const a = buildServices({ plugins: [account.plugin, media.plugin], engine: first, device: 'a', where: before.A });
      const b = buildServices({ plugins: [account.plugin, media.plugin], engine: second, device: 'b', where: before.B });
      const alex = (await a.services.profiles.create('Alex')).id;
      await signIn(a, account);
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, alex));
      await sync(a);
      await signIn(b, account);
      expect(await savedPassword(b, home.id)).toBeUndefined();

      // The update: the same databases and keychains, under an account that now seals.
      const updated = (from: typeof a, engine: Engine, name: string, where: ReturnType<typeof reopenable>): Device => ({
        ...buildServices({
          plugins: [account.pluginCarrying(SEALING), media.plugin],
          engine,
          device: name,
          where,
          credentials: from.credentials,
          deviceBound: from.deviceBound,
        }),
        where,
      });
      const devices = { A: updated(a, first, 'a-updated', before.A), B: updated(b, second, 'b-updated', before.B) };
      for (const name of [one, other, one, other]) await sync(devices[name]);
      expect(await savedPassword(devices.B, home.id)).toBe('family-secret');
      expect(await savedPassword(devices.A, home.id)).toBe('family-secret');
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
    const parts = {
      db: a.db,
      credentials: a.credentials,
      catalog: a.services.catalog,
      ids: { next: () => 'x' },
      janitor: a.janitor,
      crypto: testCrypto(),
      log: silentLog,
    };
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
