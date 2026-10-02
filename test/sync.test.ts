import { identityHash, imageRef, type AccountRecord, type ConnectionId, type UserId } from '@sc/api';
import { describe, expect, it, vi } from 'vitest';

import { draftOf, initialDraft } from '@/services/connection-draft';
import type { ConnectionDraft, ProfileDraft } from '@/services/connections';
import type { WatchProgress } from '@/services/ports';
import { checkRestoredDevice } from '@/services/restored-device';
import { sessionRef } from '@/services/sessions';

import { testCrypto } from './support/crypto';
import { ENGINE_PAIRS, mediaDraft, signIn, sync, twoDevices, type Device } from './support/devices';
import { dumpDatabase, type Engine } from './support/engines';
import { silentLog } from './support/fakes';
import { buildServices, fakeMediaPlugin } from './support/services';
import { ACCOUNT_PASSWORD, type FakeServer } from './support/sync';

const INVITE = 'GOOD-INVITE';
const NEWEST = { by: 'releaseDate', order: 'desc' } as const;
const layout = { version: 1 as const, rows: [{ id: 'continue', type: 'continue' as const, hidden: true }] };

type Media = ReturnType<typeof fakeMediaPlugin>;

async function nameOf(device: Device, id: UserId) {
  return (await device.services.profiles.get(id))?.name;
}

/** The password a device has saved for a connection — everyone's, or one profile's own. */
async function savedPassword(device: Pick<Device, 'db' | 'credentials'>, id: ConnectionId, profile?: UserId) {
  const values = profile ? (await device.db.connections.profileValues(id)).get(profile) : (await device.db.connections.get(id))?.values;
  return values?.credentialsRef ? (await device.credentials.read(values.credentialsRef))?.password : undefined;
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

function recordOf(server: FakeServer, kind: AccountRecord['kind'], key: string) {
  return server.account().records.get(`${kind}/${key}`);
}

describe.each(ENGINE_PAIRS)('two devices on %s and %s', (first: Engine, second: Engine) => {
  /** A made the account from its own — Sam and Robin — with an invite; B signed in to it. */
  async function onOneAccount(options: { readonly maxProfiles?: number } = {}) {
    const devices = twoDevices([first, second], { server: { invite: INVITE, ...options } });
    const sam = await devices.a.services.account.createLocal('Sam');
    const robin = (await devices.a.services.profiles.create('Robin')).id;
    await signIn(devices.a, devices.server, { signUp: INVITE });
    await signIn(devices.b, devices.server);
    return { ...devices, sam, robin };
  }

  describe('watch progress the app keeps', () => {
    const MINUTE = 60_000;
    const identity = 'tmdb:movie:603';
    const idOf = (profile: UserId) => `${profile}/${identityHash(identity)}`;
    /** What the watch service writes: one journaled row, its version moved on. */
    async function keep(device: Device, profile: UserId, change: Partial<WatchProgress>) {
      const current = await device.db.watchProgress.get(idOf(profile));
      const row: WatchProgress = {
        id: idOf(profile),
        userId: profile,
        identity,
        round: 0,
        watched: false,
        createdAt: '2026-10-02T10:00:00.000Z',
        updatedAt: '2026-10-02T10:00:00.000Z',
        ...current,
        ...change,
        version: (current?.version ?? 0) + 1,
      };
      await device.db.watchProgress.put(row);
    }
    const stateOn = async (device: Device, profile: UserId) => {
      const row = await device.db.watchProgress.get(idOf(profile));
      return row && { round: row.round, watched: row.watched, positionMs: row.positionMs };
    };

    it('brings where a profile got to, one record for one film on both devices', async () => {
      const { a, b, server, sam } = await onOneAccount();
      await keep(a, sam, { positionMs: 20 * MINUTE, durationMs: 100 * MINUTE });
      await sync(a);
      await sync(b);
      expect(await stateOn(b, sam)).toEqual({ round: 0, watched: false, positionMs: 20 * MINUTE });
      expect(recordOf(server, 'watchProgress', idOf(sam))?.deleted).toBe(false);
    });

    it('keeps watched when a device that had not heard plays it on', async () => {
      const { a, b, sam } = await onOneAccount();
      await keep(a, sam, { positionMs: 10 * MINUTE });
      await sync(a);
      await sync(b);
      // Finished on A; meanwhile B, not yet told, plays a little further.
      await keep(a, sam, { watched: true });
      await sync(a);
      await keep(b, sam, { positionMs: 12 * MINUTE });
      await sync(b);
      // A puts watched back, and B hears it.
      await sync(a);
      await sync(a);
      await sync(b);
      expect(await stateOn(a, sam)).toMatchObject({ watched: true });
      expect(await stateOn(b, sam)).toMatchObject({ watched: true });
    });

    it('lets "mark as unwatched" win over a device that still thought it watched', async () => {
      const { a, b, sam } = await onOneAccount();
      await keep(a, sam, { watched: true });
      await sync(a);
      await sync(b);
      await keep(a, sam, { round: 1, watched: false, positionMs: undefined as never });
      await sync(a);
      // B, which changed nothing, takes the new round.
      await sync(b);
      expect(await stateOn(b, sam)).toMatchObject({ round: 1, watched: false });

      // And a stale "watched" B sends after it gives way too.
      await keep(b, sam, { round: 0, watched: true });
      await sync(b);
      await sync(a);
      await sync(a);
      await sync(b);
      expect(await stateOn(a, sam)).toMatchObject({ round: 1, watched: false });
      expect(await stateOn(b, sam)).toMatchObject({ round: 1, watched: false });
    });

    it('brings a rewind made on one device to the other', async () => {
      const { a, b, sam } = await onOneAccount();
      await keep(a, sam, { positionMs: 80 * MINUTE });
      await sync(a);
      await sync(b);
      await keep(a, sam, { positionMs: 20 * MINUTE });
      await sync(a);
      await sync(b);
      expect(await stateOn(b, sam)).toMatchObject({ positionMs: 20 * MINUTE });
    });

    it('carries which tabs the account keeps watch status on', async () => {
      const { a, b } = await onOneAccount();
      await a.services.accountSettings.setWatchStatus({ media: true, videos: false });
      await sync(a);
      await sync(b);
      expect(await b.services.accountSettings.watchStatus()).toEqual({ media: true, videos: false, tv: true });
    });
  });

  describe('what reaches the other device', () => {
    it('keeps one of a channel two devices chose offline, the same one on both', async () => {
      const { a, b, server, media, sam } = await onOneAccount();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, sam));
      await sync(a);
      await sync(b);
      const same = { userId: sam, connectionId: home.id, externalId: 'ch:101', name: 'Das Erste', addedAt: '2026-10-02T12:00:00.000Z', version: 1 };
      await a.db.favoriteChannels.put({ ...same, id: 'fav-b' });
      await b.db.favoriteChannels.put({ ...same, id: 'fav-a' });
      await sync(a);
      await sync(b);
      await sync(a);
      await sync(b);
      expect((await a.db.favoriteChannels.listAll()).map((entry) => entry.id)).toEqual(['fav-a']);
      expect((await b.db.favoriteChannels.listAll()).map((entry) => entry.id)).toEqual(['fav-a']);
      expect(recordOf(server, 'favoriteChannel', 'fav-b')?.deleted).toBe(true);
    });

    it('brings the account’s profiles to a device signing in', async () => {
      const { b, server, sam, robin } = await onOneAccount();
      expect(server.profileNames()).toEqual(['Robin', 'Sam']);
      expect((await b.services.profiles.list()).map((profile) => profile.id)).toEqual(expect.arrayContaining([sam, robin]));
      expect(b.engine.status()).toMatchObject({ phase: 'synced', pending: 0 });
    });

    it('brings a rename, a layout and a PIN — the PIN into the keychain, never the database', async () => {
      const { a, b, sam } = await onOneAccount();
      await a.services.pins.create(sam, '9731');
      await a.services.homeLayout.update(sam, () => layout.rows);
      await a.services.profiles.rename(sam, 'Sam, renamed');
      await sync(a);
      await sync(b);
      expect(await nameOf(b, sam)).toBe('Sam, renamed');
      expect(await b.services.homeLayout.rows(sam)).toEqual(layout.rows);
      expect(await b.services.pins.verify(sam, '9731')).toEqual({ ok: true });
      expect(await dumpDatabase(second, b.where)).not.toContain('9731');
    });

    it('brings a connection and its passwords — everyone’s and each profile’s — into the keychain', async () => {
      const { a, b, media, sam, robin } = await onOneAccount();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, sam));
      const own = await a.services.connections.create(media.manifest.id, perProfileDraft(media, { [sam]: ['sam', 'sam-secret'], [robin]: ['robin', 'robin-secret'] }));
      await sync(a);
      await sync(b);
      expect(await savedPassword(b, home.id)).toBe('family-secret');
      expect(await savedPassword(b, own.id, sam)).toBe('sam-secret');
      expect(await savedPassword(b, own.id, robin)).toBe('robin-secret');
      const dump = await dumpDatabase(second, b.where);
      for (const secret of ['family-secret', 'sam-secret', 'robin-secret']) expect(dump).not.toContain(secret);
      const row = await b.services.media.row(sam, { kind: 'movies', sort: NEWEST }, 10);
      expect(row.sourceErrors).toEqual([]);
      expect(row.items.length).toBeGreaterThan(0);
    });

    it('brings a profile’s favourite channels, and their removal made elsewhere', async () => {
      const { a, b, media, sam } = await onOneAccount();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, sam));
      await a.db.favoriteChannels.put({
        id: 'fav-1',
        userId: sam,
        connectionId: home.id,
        externalId: 'ch:101',
        name: 'Das Erste',
        number: 1,
        logo: imageRef('http://portal.test/101.png'),
        addedAt: '2026-10-02T12:00:00.000Z',
        version: 1,
      });
      await a.db.favoriteChannels.put({ id: 'fav-2', userId: sam, connectionId: home.id, externalId: 'ch:102', name: 'Stadium One', addedAt: '2026-10-02T12:01:00.000Z', version: 1 });
      await sync(a);
      await sync(b);
      expect((await b.db.favoriteChannels.list(sam)).map((entry) => [entry.externalId, entry.name, entry.number, entry.logo])).toEqual([
        ['ch:102', 'Stadium One', undefined, undefined],
        ['ch:101', 'Das Erste', 1, 'http://portal.test/101.png'],
      ]);

      // Removed on B, and the removal reaches A — the other favourite stays.
      await b.db.favoriteChannels.remove('fav-1');
      await sync(b);
      await sync(a);
      expect((await a.db.favoriteChannels.listAll()).map((entry) => entry.id)).toEqual(['fav-2']);
    });

    it('brings a profile’s own lists, and a delete made elsewhere', async () => {
      const { a, b, media, sam } = await onOneAccount();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, sam));
      await a.db.subscriptions.put({
        id: 'sub-1',
        userId: sam,
        connectionId: home.id,
        externalId: 'UC1',
        title: 'Some Channel',
        addedAt: '2026-10-01T12:00:00.000Z',
        version: 1,
      });
      await a.db.playlists.put({
        id: 'list-1',
        userId: sam,
        title: 'Rewatch',
        items: [{ connectionId: home.id, externalId: 'm1' }],
        createdAt: '2026-10-01T12:00:00.000Z',
        updatedAt: '2026-10-01T12:00:00.000Z',
        version: 1,
      });
      await sync(a);
      await sync(b);
      expect((await b.db.subscriptions.list(sam)).map((entry) => entry.title)).toEqual(['Some Channel']);
      expect((await b.db.playlists.list(sam)).map((entry) => entry.title)).toEqual(['Rewatch']);
      // Following twice follows once, whichever device asked.
      expect((await b.db.subscriptions.forChannel(sam, home.id, 'UC1'))?.id).toBe('sub-1');

      // Unfollowed on B, and the delete reaches A.
      await b.db.subscriptions.remove('sub-1');
      await sync(b);
      await sync(a);
      expect(await a.db.subscriptions.listAll()).toEqual([]);

      // A list edited as a whole: the last push wins, items and all.
      await b.db.playlists.put({
        ...((await b.db.playlists.get('list-1')) ?? ({} as never)),
        title: 'Rewatch, renamed',
        items: [],
        updatedAt: '2026-10-01T13:00:00.000Z',
        version: 2,
      });
      await sync(b);
      await sync(a);
      expect(await a.db.playlists.get('list-1')).toMatchObject({ title: 'Rewatch, renamed', items: [] });
    });

    it('writes nothing it applied into the journal, so nothing comes back for ever', async () => {
      const { a, b, server, sam } = await onOneAccount();
      await a.services.profiles.rename(sam, 'Renamed on A');
      await sync(a);
      const pushes = server.calls.pushes;
      await sync(b);
      await sync(b);
      await sync(a);
      expect(server.calls.pushes).toBe(pushes);
      expect(await nameOf(b, sam)).toBe('Renamed on A');
      expect(b.engine.status()).toMatchObject({ phase: 'synced', pending: 0 });
    });
  });

  describe('pushing', () => {
    it('counts a change as waiting as soon as it is made, and as sent once it went', async () => {
      const { a, sam } = await onOneAccount();
      await a.services.profiles.rename(sam, 'Waiting');
      await a.engine.changed();
      expect(a.engine.status().pending).toBe(1);
      await sync(a);
      expect(a.engine.status()).toMatchObject({ phase: 'synced', pending: 0 });
    });

    it('sends each record once, as its row is now, parents first', async () => {
      const { a, server, media, sam } = await onOneAccount();
      await a.services.profiles.rename(sam, 'One');
      await a.services.profiles.rename(sam, 'Two');
      const kim = (await a.services.profiles.create('Kim')).id;
      await a.services.connections.create(media.manifest.id, perProfileDraft(media, { [kim]: ['kim', 'kim-secret'] }));
      await a.services.pins.create(kim, '2468');
      const before = server.pushed.length;
      await sync(a);
      const sent = server.pushed.slice(before).flat();
      expect(sent.filter((record) => record.kind === 'profile' && record.key === sam)).toEqual([
        { kind: 'profile', key: sam, deleted: false, data: { userId: sam, name: 'Two' } },
      ]);
      const kinds = sent.map((record) => record.kind);
      expect(kinds.lastIndexOf('profile')).toBeLessThan(kinds.indexOf('pin'));
      expect(kinds.lastIndexOf('pin')).toBeLessThan(kinds.indexOf('connection'));
      expect(kinds.lastIndexOf('connection')).toBeLessThan(kinds.indexOf('profileValues'));
    });

    it('converges after an answer lost on the way back', async () => {
      const { a, b, server, sam } = await onOneAccount();
      await a.services.profiles.rename(sam, 'Lost answer');
      server.loseNextAnswer();
      await sync(a);
      expect(a.engine.status()).toMatchObject({ phase: 'waiting', pending: 1, problem: { code: 'TIMEOUT' } });
      await sync(a);
      expect(a.engine.status()).toMatchObject({ phase: 'synced', pending: 0 });
      await sync(b);
      expect(await nameOf(b, sam)).toBe('Lost answer');
    });

    it('leaves out a write the server refuses, and says so, without holding the rest back — or sending it on every run', async () => {
      const { a, server, sam } = await onOneAccount();
      server.refuseWrites((record) => (record.kind === 'preference' ? 'invalid' : undefined));
      await a.services.homeLayout.update(sam, () => layout.rows);
      await a.services.profiles.rename(sam, 'Still goes');
      await sync(a);
      expect(server.profileNames()).toContain('Still goes');
      expect(recordOf(server, 'preference', `${sam}/homeLayout`)).toBeUndefined();
      expect(a.engine.status()).toMatchObject({ phase: 'synced', pending: 0 });
      const pushes = server.calls.pushes;
      await sync(a);
      expect(server.calls.pushes).toBe(pushes);
    });
  });

  describe('reconciling', () => {
    it('leaves alone a change made here while the run was reading: it goes next, and wins', async () => {
      const { a, b, server, sam } = await onOneAccount();
      await b.services.profiles.rename(sam, 'From B');
      await sync(b);
      server.duringNextPull(() => a.services.profiles.rename(sam, 'Made on A meanwhile'));
      await sync(a);
      expect(await nameOf(a, sam)).toBe('Made on A meanwhile');
      expect(a.engine.status().pending).toBe(1);
      await sync(a);
      await sync(b);
      expect(await nameOf(b, sam)).toBe('Made on A meanwhile');
    });

    it('lets a profile deleted elsewhere go, even while this device was changing it — with everything of it', async () => {
      const { a, b, server, robin } = await onOneAccount();
      await b.services.profiles.remove(robin);
      await sync(b);
      await a.services.profiles.rename(robin, 'Renamed on A');
      await a.services.homeLayout.update(robin, () => layout.rows);
      await sync(a);
      expect(await a.services.profiles.get(robin)).toBeUndefined();
      expect(a.engine.status()).toMatchObject({ phase: 'synced', pending: 0 });
      expect(server.profileNames()).toEqual(['Sam']);
      expect(recordOf(server, 'preference', `${robin}/homeLayout`)).toBeUndefined();
    });

    it('takes even the last profile, and sends the device back to the start', async () => {
      const { a, server, sam, robin } = await onOneAccount();
      await a.services.session.start();
      server.put({ kind: 'profile', key: sam, deleted: true });
      server.put({ kind: 'profile', key: robin, deleted: true });
      await sync(a);
      expect(await a.services.profiles.list()).toEqual([]);
      await vi.waitFor(() => expect(a.services.session.getSnapshot().kind).toBe('needs-first-user'));
    });

    it('replaces what differs with the server’s version: a name, a PIN, a connection and its password', async () => {
      const { a, server, media, sam } = await onOneAccount();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, sam));
      await a.services.pins.create(sam, '1357');
      await sync(a);
      const oldPin = (await a.db.users.get(sam))?.pinCredentialRef;
      const connection = recordOf(server, 'connection', home.id);
      if (connection?.kind !== 'connection' || connection.deleted) throw new Error('setup');

      server.put({ kind: 'profile', key: sam, deleted: false, data: { userId: sam, name: 'Renamed elsewhere' } });
      server.put({ kind: 'pin', key: sam, deleted: false, data: { userId: sam, pin: '8080' } });
      server.put({ ...connection, data: { ...connection.data, label: 'Moved', fields: { ...connection.data.fields, serverUrl: 'http://moved:8096' }, secrets: { password: 'new-secret' } } });
      await sync(a);

      expect(await nameOf(a, sam)).toBe('Renamed elsewhere');
      expect(await a.services.pins.verify(sam, '8080')).toEqual({ ok: true });
      expect(oldPin && (await a.credentials.read(oldPin))).toBeUndefined();
      expect((await a.db.connections.get(home.id))?.label).toBe('Moved');
      expect(await savedPassword(a, home.id)).toBe('new-secret');
    });

    it('puts back what a server restored from an older copy lost', async () => {
      const { a, b, server, media, sam } = await onOneAccount();
      const restore = server.snapshot();
      const kim = (await a.services.profiles.create('Kim')).id;
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, sam));
      await sync(a);
      restore();
      expect(server.profileNames()).toEqual(['Robin', 'Sam']);

      await sync(a);
      expect(a.engine.status().pending).toBeGreaterThan(0);
      await sync(a);
      expect(server.profileNames()).toEqual(['Kim', 'Robin', 'Sam']);
      expect(recordOf(server, 'connection', home.id)).toMatchObject({ deleted: false, data: { secrets: { password: 'family-secret' } } });
      await sync(b);
      expect(await nameOf(b, kim)).toBe('Kim');
    });
  });

  describe('the profile limit', () => {
    it('keeps a profile over it on this device only, and sends it once there is room', async () => {
      const { a, b, server } = await onOneAccount({ maxProfiles: 3 });
      const kim = (await a.services.profiles.create('Kim')).id;
      const lee = (await b.services.profiles.create('Lee')).id;
      await b.services.pins.create(lee, '4321');
      await sync(a);
      await sync(b);

      expect(server.profileNames()).toEqual(['Kim', 'Robin', 'Sam']);
      expect((await b.services.profiles.list()).map((profile) => profile.name).sort()).toEqual(['Kim', 'Lee', 'Robin', 'Sam']);
      expect(await b.services.account.heldBack()).toEqual(new Set([lee]));
      expect(b.engine.status()).toMatchObject({ phase: 'synced', pending: 0 });
      await expect(b.services.profiles.create('One more')).rejects.toMatchObject({ code: 'INVALID_STATE' });
      const pushes = server.calls.pushes;
      await sync(b);
      expect(server.calls.pushes).toBe(pushes);

      await a.services.profiles.remove(kim);
      await sync(a);
      await sync(b);
      await sync(b);
      expect(server.profileNames()).toEqual(['Lee', 'Robin', 'Sam']);
      expect(recordOf(server, 'pin', lee)).toMatchObject({ data: { pin: '4321' } });
      expect(await b.services.account.heldBack()).toEqual(new Set());
    });
  });

  describe('passwords', () => {
    it('stay on the server when a device edits a connection it has lost the password of — and come back to it', async () => {
      const { a, b, server, media, sam } = await onOneAccount();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, sam));
      await sync(a);
      await sync(b);
      const ref = (await b.db.connections.get(home.id))?.values.credentialsRef;
      if (ref) await b.credentials.delete(ref);

      const onB = await b.services.connections.edit(home.id);
      if (!onB) throw new Error('setup');
      await b.services.connections.update(home.id, { ...draftOf(media.manifest, onB), label: 'Renamed on B' });
      await sync(b);
      expect(recordOf(server, 'connection', home.id)).toMatchObject({ data: { label: 'Renamed on B', secrets: { password: 'family-secret' } } });
      expect(await savedPassword(b, home.id)).toBe('family-secret');
      await sync(a);
      expect((await a.db.connections.get(home.id))?.label).toBe('Renamed on B');
      expect(await savedPassword(a, home.id)).toBe('family-secret');
    });

    it('are asked for on a device that has none, and nothing signs in without one', async () => {
      const { a, b, media, sam } = await onOneAccount();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, sam));
      // A's keychain lost it before its first push: no device has it.
      const ref = (await a.db.connections.get(home.id))?.values.credentialsRef;
      if (ref) await a.credentials.delete(ref);
      await sync(a);
      await sync(b);
      const result = await b.services.media.row(sam, { kind: 'movies', sort: NEWEST }, 10);
      expect(result.sourceErrors).toMatchObject([{ needsPassword: true }]);
      expect(media.stats.signedInWith.filter((secrets) => secrets.password === undefined)).toEqual([]);
    });

    it('send a PIN only when this device can read it, never as none', async () => {
      const { a, server, sam } = await onOneAccount();
      await a.services.pins.create(sam, '1357');
      await sync(a);
      expect(recordOf(server, 'pin', sam)).toMatchObject({ data: { pin: '1357' } });
      await a.services.pins.change(sam, '1357', '2468');
      const ref = (await a.db.users.get(sam))?.pinCredentialRef;
      if (ref) await a.credentials.delete(ref);
      await sync(a);
      expect(recordOf(server, 'pin', sam)).toMatchObject({ data: { pin: '1357' } });
    });
  });

  describe('a phone restored from another’s backup', () => {
    const check = (device: Device, key: string) =>
      checkRestoredDevice({ db: device.db, deviceKey: async () => key, sha256: testCrypto().sha256, log: silentLog });

    it('drops the changes it had not sent, and its session, and takes the server’s version', async () => {
      const { a, b, server, sam } = await onOneAccount();
      expect(await check(b, 'key-of-b')).toBe('first');
      expect(await check(b, 'key-of-b')).toBe('same');
      await b.services.profiles.rename(sam, 'Stale, from the backup');
      await a.services.profiles.rename(sam, 'Newer, from A');
      await sync(a);
      const current = await b.services.account.current();
      if (current?.kind !== 'server') throw new Error('setup');
      const signIns = server.calls.signIns;

      // B's database comes back on a new phone, with another device key.
      expect(await check(b, 'key-of-the-new-phone')).toBe('restored');
      await b.janitor.drain();
      expect(await b.db.journal.entries()).toEqual([]);
      expect(await b.deviceBound.read(sessionRef(current.connection.id, 'account'))).toBeUndefined();
      await sync(b);
      expect(await nameOf(b, sam)).toBe('Newer, from A');
      expect(server.profileNames()).toContain('Newer, from A');
      expect(server.calls.signIns).toBe(signIns + 1);
      expect(JSON.stringify(await b.db.deviceSettings.get())).not.toContain('key-of-the-new-phone');
    });
  });

  describe('what never travels', () => {
    it('keeps the device’s own things off the account: its sign-in, its default profile', async () => {
      const { a, b, server, robin } = await onOneAccount();
      await a.services.profiles.setDefault(robin);
      await sync(a);
      const current = await a.services.account.current();
      if (current?.kind !== 'server') throw new Error('setup');
      const records = [...server.account().records.values()];
      expect(records.some((record) => record.kind === 'connection' && record.key === current.connection.id)).toBe(false);
      expect(JSON.stringify(records)).not.toContain(ACCOUNT_PASSWORD);
      await sync(b);
      expect(await b.services.profiles.defaultUserId()).toBeUndefined();
    });

    it('keeps a connection of a plugin this build lacks, as it came, and never sends it back', async () => {
      const extra = fakeMediaPlugin('extra');
      const { a, server, media, plugins, sam } = await (async () => {
        const devices = twoDevices([first, second], { server: { invite: INVITE }, extra: [extra.plugin] });
        const id = await devices.a.services.account.createLocal('Sam');
        await signIn(devices.a, devices.server, { signUp: INVITE });
        return { ...devices, sam: id };
      })();
      const kept = await a.services.connections.create(extra.manifest.id, mediaDraft(extra, sam));
      await sync(a);

      const without = buildServices({ plugins: plugins.filter((plugin) => plugin !== extra.plugin), engine: second, device: 'c' });
      await signIn(without, server);
      expect((await without.db.connections.get(kept.id))?.values.fields).toEqual((await a.db.connections.get(kept.id))?.values.fields);
      expect(await without.services.sources.forUser(sam)).toEqual([]);
      const pushes = server.calls.pushes;
      await sync(without);
      expect(server.calls.pushes).toBe(pushes);
      expect(media.stats.connects).toBe(0);
    });

    it('purges no saved media for its own echo', async () => {
      const { a, media, sam } = await onOneAccount();
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, sam));
      await sync(a);
      await a.db.mediaCache.putList(sam, home.id, 'row:movies', 'print', { items: [], savedAt: 1 });
      await sync(a);
      expect(await a.db.mediaCache.list(sam, home.id, 'row:movies', 'print')).toBeDefined();
    });
  });
});
