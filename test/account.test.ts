import { AppError, isAppError } from '@loge/api';
import { describe, expect, it, vi } from 'vitest';

import { AccountCreatedError, OwnerNotVerifiedError } from '@/services/account';
import { sessionRef } from '@/services/sessions';

import { againTarget, mediaDraft, signIn, sync, target, twoDevices } from './support/devices';
import { dumpDatabase, ENGINES, type Engine } from './support/engines';
import { buildServices, fakeMediaPlugin } from './support/services';
import { ACCOUNT_PASSWORD, fakeAccountServer, fakeOwnerAuthentication } from './support/sync';

const INVITE = 'GOOD-INVITE';
const layout = { version: 1 as const, rows: [{ id: 'continue', type: 'continue' as const, hidden: true }] };

describe.each(ENGINES)('the account on %s', (engine: Engine) => {
  const pair = (options: { readonly maxProfiles?: number } = {}) => twoDevices([engine, engine], { server: { invite: INVITE, ...options } });

  /** B made the account from Sam and Robin; A holds an account of its own on the device: Lee, and a source with a password. */
  async function twoAccounts() {
    const devices = pair();
    await devices.b.services.account.createLocal('Sam');
    await devices.b.services.profiles.create('Robin');
    await signIn(devices.b, devices.server, { signUp: INVITE });
    const lee = await devices.a.services.account.createLocal('Lee');
    const home = await devices.a.services.connections.create(devices.media.manifest.id, mediaDraft(devices.media, lee));
    return { ...devices, lee, home };
  }

  describe('on this device', () => {
    it('is made at first launch with its first profile, named after it', async () => {
      const { a } = pair();
      const id = await a.services.account.createLocal('The Smiths');
      expect(await a.services.account.current()).toMatchObject({ kind: 'local', name: 'The Smiths' });
      expect((await a.services.profiles.list()).map((profile) => [profile.id, profile.name])).toEqual([[id, 'The Smiths']]);
      expect(await a.services.profiles.defaultUserId()).toBe(id);
      await a.services.session.start();
      expect(a.services.session.getSnapshot()).toEqual({ kind: 'ready', userId: id });
      await expect(a.services.account.createLocal('Again')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('is what a device from an earlier version keeps its profiles as — and a new one is asked for', async () => {
      const { a, b } = pair();
      await a.services.account.ensureAccount();
      expect(await a.services.account.current()).toBeUndefined();
      await a.services.session.start();
      expect(a.services.session.getSnapshot()).toEqual({ kind: 'needs-account' });

      const kids = (await b.services.profiles.create('Kids')).id;
      await b.services.profiles.create('Alex');
      await b.services.account.ensureAccount();
      await b.services.account.ensureAccount();
      expect(await b.services.account.current()).toMatchObject({ kind: 'local', name: 'Kids' });
      await b.services.session.start();
      expect(b.services.session.getSnapshot()).toEqual({ kind: 'ready', userId: kids });
    });

    it('holds ten profiles, and says so', async () => {
      const { a } = pair();
      await a.services.account.createLocal('One');
      for (let count = 2; count <= 10; count += 1) await a.services.profiles.create(`Profile ${count}`);
      expect(await a.services.account.maxProfiles()).toBe(10);
      await expect(a.services.profiles.create('Eleven')).rejects.toMatchObject({ code: 'INVALID_STATE' });
      expect(await a.services.profiles.list()).toHaveLength(10);
    });

    it('journals nothing for a server to read', async () => {
      const { a } = pair();
      const id = await a.services.account.createLocal('Lee');
      await a.services.profiles.rename(id, 'Lee, renamed');
      await sync(a);
      expect(a.engine.status()).toMatchObject({ phase: 'idle', pending: 0 });
      expect(await a.db.journal.entries()).toEqual([]);
    });
  });

  describe('signing in replaces', () => {
    it('this device’s profiles and sources with the account’s, keeping nothing of them', async () => {
      const { a, server, lee, home } = await twoAccounts();
      const prepared = await a.services.account.prepare(target(server));
      expect(prepared).toMatchObject({ kind: 'replace', accountProfiles: ['Sam', 'Robin'], deviceProfiles: ['Lee'] });
      await a.services.account.complete(prepared);

      expect((await a.services.profiles.list()).map((profile) => profile.name).sort()).toEqual(['Robin', 'Sam']);
      expect(await a.services.profiles.get(lee)).toBeUndefined();
      expect(await a.db.connections.get(home.id)).toBeUndefined();
      expect(JSON.stringify([...a.credentials.entries.values()])).not.toContain('family-secret');
      expect(await a.services.account.current()).toMatchObject({ kind: 'server', name: 'sam on the fake server', maxProfiles: 10 });
      // Nothing of the device's own account reached the server.
      expect(server.profileNames()).toEqual(['Robin', 'Sam']);
    });

    it('saves nothing until it is completed, PINs included', async () => {
      const { a, b, server } = pair();
      const sam = await b.services.account.createLocal('Sam');
      await b.services.pins.create(sam, '9731');
      await signIn(b, server, { signUp: INVITE });
      const prepared = await a.services.account.prepare(target(server));
      expect(await a.services.account.current()).toBeUndefined();
      expect(await a.db.connections.list()).toEqual([]);
      expect(JSON.stringify([...a.credentials.entries.values()])).not.toContain('9731');
      await a.services.account.complete(prepared);
      expect(await a.services.pins.verify(sam, '9731')).toEqual({ ok: true });
      expect(await dumpDatabase(engine, a.where)).not.toContain('9731');
    });

    it('is tried once, refused for good, and leaves nothing behind', async () => {
      const { a, server, home } = await twoAccounts();
      const secrets = a.credentials.entries.size;
      const failure = await a.services.account.prepare(target(server, { password: 'a wrong password' })).catch((error: unknown) => error);
      expect(isAppError(failure) && failure.code).toBe('UNAUTHORIZED');
      expect(server.calls.signIns).toBe(1);
      expect((await a.db.connections.list()).map((connection) => connection.id)).toEqual([home.id]);
      expect(a.credentials.entries.size).toBe(secrets);
      expect(await a.services.account.current()).toMatchObject({ kind: 'local' });
    });

    it('signs in once: the sign-in’s session becomes the account’s, even with a run asked for meanwhile', async () => {
      const { a, server } = await twoAccounts();
      const signIns = server.calls.signIns;
      const prepared = await a.services.account.prepare(target(server));
      await Promise.all([a.services.account.complete(prepared), a.engine.run()]);
      await sync(a);
      await a.services.sync.now();
      expect(a.engine.status().phase).toBe('synced');
      expect(server.calls.signIns).toBe(signIns + 1);
    });

    it('moves the gate to “Who’s watching?”, never navigating: the profile in use may be gone', async () => {
      const { a, server, lee } = await twoAccounts();
      await a.services.session.start();
      expect(a.services.session.getSnapshot()).toEqual({ kind: 'ready', userId: lee });
      await signIn(a, server);
      await vi.waitFor(() => expect(a.services.session.getSnapshot().kind).toBe('needs-user-selection'));
    });

    it('switches to another account: the old one gets what it had not yet, and hears that this device left', async () => {
      const { a, server } = await twoAccounts();
      server.account('alex');
      await signIn(a, server, { proof: ACCOUNT_PASSWORD });
      const [sam] = await a.services.profiles.list();
      if (!sam) throw new Error('setup');
      await a.services.profiles.rename(sam.id, 'Renamed before switching');
      const signOuts = server.calls.signOuts;

      await signIn(a, server, { username: 'alex', proof: ACCOUNT_PASSWORD });
      expect(server.profileNames()).toContain('Renamed before switching');
      expect(server.calls.signOuts).toBe(signOuts + 1);
      expect(await a.services.profiles.list()).toEqual([]);
      const current = await a.services.account.current();
      expect(current).toMatchObject({ kind: 'server', name: 'alex on the fake server' });
      expect((await a.db.connections.list()).map((connection) => connection.pluginId)).toEqual([server.plugin.manifest.id]);
    });
  });

  describe('signing up', () => {
    it('uploads the account on this device: profiles, PINs, layouts, sources and their passwords', async () => {
      const { a, b, server, media } = pair();
      const lee = await a.services.account.createLocal('Lee');
      await a.services.pins.create(lee, '2468');
      await a.services.homeLayout.update(lee, () => layout.rows);
      const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, lee));
      const done = await signIn(a, server, { signUp: INVITE });
      expect(done).toMatchObject({ kind: 'upload', created: true });
      expect(a.engine.status()).toMatchObject({ phase: 'synced', pending: 0 });

      await signIn(b, server);
      expect(await b.services.profiles.get(lee)).toMatchObject({ name: 'Lee', pinProtected: true });
      expect(await b.services.pins.verify(lee, '2468')).toEqual({ ok: true });
      expect(await b.services.homeLayout.rows(lee)).toEqual(layout.rows);
      expect((await b.db.connections.get(home.id))?.label).toBe(home.label);
      await expect(b.services.connections.probeSecrets(media.manifest.id, home.id, 'shared', {})).resolves.toEqual({ password: 'family-secret' });
    });

    it('refuses up front an upload the server has no room for, and creates nothing', async () => {
      const { a, server } = pair({ maxProfiles: 1 });
      await a.services.account.createLocal('Lee');
      await a.services.profiles.create('Kim');
      await expect(a.services.account.prepare(target(server, { signUp: INVITE }))).rejects.toMatchObject({ code: 'INVALID_STATE' });
      expect(server.calls.creates).toBe(0);
    });

    it('asks the server for a first profile on a device without one', async () => {
      const { a, server } = pair();
      const done = await signIn(a, server, { signUp: INVITE });
      expect(done).toMatchObject({ kind: 'replace', profilesArrived: 1 });
      expect((await a.services.profiles.list()).map((profile) => profile.name)).toEqual(['sam']);
      expect(server.profileNames()).toEqual(['sam']);
    });

    it('creates nothing for a refused invite, and does not try again', async () => {
      const { a, server } = pair();
      await a.services.account.createLocal('Lee');
      const failure = await a.services.account.prepare(target(server, { signUp: 'USED-INVITE' })).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'INVALID_STATE' });
      expect(server.calls.creates).toBe(1);
      expect(await a.db.connections.list()).toEqual([]);
    });

    it('says so when it was created and what came after failed — and is signed in to, never created again', async () => {
      const { a, server } = pair();
      server.failNextPull(new AppError('PROVIDER_UNAVAILABLE', 'Down for a moment.', { retry: 'backoff' }));
      expect(await a.services.account.prepare(target(server, { signUp: INVITE })).catch((error: unknown) => error)).toBeInstanceOf(AccountCreatedError);
      await signIn(a, server);
      expect(await a.services.account.current()).toMatchObject({ kind: 'server' });
      expect(server.calls.creates).toBe(1);
    });

    it('signs in once: the account takes the sign-up’s session', async () => {
      const { a, server } = pair();
      await a.services.account.createLocal('Lee');
      await signIn(a, server, { signUp: INVITE });
      await sync(a);
      expect(a.engine.status().phase).toBe('synced');
      expect(server.calls).toMatchObject({ creates: 1, signIns: 0 });
    });
  });

  describe('a sign-in that stops working', () => {
    it('is parked when the password changed elsewhere, and “Sync now” does not try it again', async () => {
      const { b, server } = await twoAccounts();
      server.changePassword('a new password');
      await sync(b);
      expect(b.engine.status()).toMatchObject({ phase: 'needs-sign-in', problem: { code: 'UNAUTHORIZED' } });
      const signIns = server.calls.signIns;
      await b.services.sync.now();
      await sync(b);
      expect(server.calls.signIns).toBe(signIns);
    });

    it('is signed in to again with the new password alone, without the owner check, changing nothing else', async () => {
      const { b, server } = await twoAccounts();
      const before = await b.services.account.current();
      if (before?.kind !== 'server') throw new Error('setup');
      server.changePassword('a new password');
      await sync(b);

      const prepared = await b.services.account.prepare(againTarget(server, 'a new password'));
      expect(prepared.kind).toBe('again');
      await b.services.account.complete(prepared);
      const after = await b.services.account.current();
      expect(after).toMatchObject({ kind: 'server', id: before.id, name: before.name });
      if (after?.kind !== 'server') throw new Error('setup');
      expect(after.connection.values.fields).toEqual(before.connection.values.fields);
      expect(b.engine.status().phase).toBe('synced');
      expect((await b.services.profiles.list()).map((profile) => profile.name).sort()).toEqual(['Robin', 'Sam']);
    });

    it('signs itself in again once, with the saved password, after a session ended — thirty days offline', async () => {
      const { b, server } = await twoAccounts();
      const signIns = server.calls.signIns;
      server.endSessions();
      await sync(b);
      expect(b.engine.status().phase).toBe('synced');
      expect(server.calls.signIns).toBe(signIns + 1);
    });

    it('shows as unavailable in a build without its plugin, and can still be signed out of', async () => {
      const { b } = await twoAccounts();
      const withoutIt = buildServices({ plugins: [fakeMediaPlugin('fake').plugin], engine, device: 'b', where: b.where, credentials: b.credentials, deviceBound: b.deviceBound });
      expect(await withoutIt.services.account.current()).toMatchObject({ kind: 'server', available: false });
      await withoutIt.engine.run();
      expect(withoutIt.engine.status().phase).toBe('unavailable');
      await withoutIt.services.account.signOut();
      expect(await withoutIt.services.account.current()).toMatchObject({ kind: 'local' });
    });
  });

  describe('signing out', () => {
    it('keeps everything as an account on this device, and lets the server go', async () => {
      const { b, server } = await twoAccounts();
      const before = await b.services.account.current();
      if (before?.kind !== 'server') throw new Error('setup');
      const [sam] = await b.services.profiles.list();
      if (!sam) throw new Error('setup');
      await b.services.homeLayout.update(sam.id, () => layout.rows);
      const session = sessionRef(before.connection.id, 'account');
      expect(await b.deviceBound.read(session)).toBeDefined();

      await b.services.account.signOut({ password: ACCOUNT_PASSWORD });
      expect(await b.services.account.current()).toMatchObject({ kind: 'local', name: before.name });
      expect(await b.db.connections.get(before.connection.id)).toBeUndefined();
      expect(await b.deviceBound.read(session)).toBeUndefined();
      expect(JSON.stringify([...b.credentials.entries.values()])).not.toContain(ACCOUNT_PASSWORD);
      expect((await b.services.profiles.list()).map((profile) => profile.name).sort()).toEqual(['Robin', 'Sam']);
      expect(await b.services.homeLayout.rows(sam.id)).toEqual(layout.rows);
      expect(await b.db.journal.entries()).toEqual([]);
      expect(server.calls.signOuts).toBe(1);
      // What changed before signing out reached the account first.
      expect(server.account().records.get(`preference/${sam.id}/homeLayout`)).toBeDefined();
    });

    it('is refused a removal of the account’s connection: signing out comes first', async () => {
      const { b } = await twoAccounts();
      const current = await b.services.account.current();
      if (current?.kind !== 'server') throw new Error('setup');
      await expect(b.services.connections.remove(current.connection.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('keeps every profile of a local copy that holds more than ten, and takes no new one', async () => {
      const { a, server } = pair({ maxProfiles: 12 });
      await a.services.account.createLocal('One');
      for (let count = 2; count <= 10; count += 1) await a.services.profiles.create(`Profile ${count}`);
      await signIn(a, server, { signUp: INVITE });
      await a.services.profiles.create('Eleven');
      await sync(a);
      await a.services.account.signOut({ password: ACCOUNT_PASSWORD });
      expect(await a.services.profiles.list()).toHaveLength(11);
      await expect(a.services.profiles.create('Twelve')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });
  });

  describe('the owner check', () => {
    it('asks for the account password again, and never takes the saved one', async () => {
      const { b, server } = await twoAccounts();
      expect(await b.services.owner.method()).toMatchObject({ via: 'account', asks: [{ key: 'password', type: 'password' }] });
      await expect(b.services.account.signOut({ password: 'a guess' })).rejects.toMatchObject({ verdict: 'refused' });
      await expect(b.services.account.signOut()).rejects.toMatchObject({ verdict: 'refused' });
      expect(await b.services.account.current()).toMatchObject({ kind: 'server' });
      await b.services.account.signOut({ password: ACCOUNT_PASSWORD });
      expect(await b.services.account.current()).toMatchObject({ kind: 'local' });
      expect(server.calls.owners).toBe(2);
    });

    it('asks the current account before switching away from it', async () => {
      const { b, server } = await twoAccounts();
      server.account('alex');
      const signIns = server.calls.signIns;
      await expect(b.services.account.prepare(target(server, { username: 'alex' }))).rejects.toBeInstanceOf(OwnerNotVerifiedError);
      expect(server.calls.signIns).toBe(signIns);
      await signIn(b, server, { username: 'alex', proof: ACCOUNT_PASSWORD });
      expect(await b.services.account.current()).toMatchObject({ name: 'alex on the fake server' });
    });

    it('asks the device on an account kept here, before it is replaced', async () => {
      const server = fakeAccountServer({ invite: INVITE });
      server.account();
      const owner = fakeOwnerAuthentication({ available: true, answer: 'refused' });
      const device = buildServices({ plugins: [server.plugin], engine, device: 'guarded', owner });
      await device.services.account.createLocal('Lee');
      await expect(device.services.account.prepare(target(server))).rejects.toBeInstanceOf(OwnerNotVerifiedError);
      expect(server.calls.signIns).toBe(0);
      owner.set({ available: true, answer: 'cancelled' });
      await expect(device.services.account.prepare(target(server))).rejects.toMatchObject({ verdict: 'cancelled' });
    });

    it('is not asked at first launch, and goes ahead where no owner can be asked', async () => {
      const server = fakeAccountServer({ invite: INVITE });
      server.account();
      const owner = fakeOwnerAuthentication({ available: true, answer: 'refused' });
      const fresh = buildServices({ plugins: [server.plugin], engine, device: 'fresh', owner });
      await signIn(fresh, server);
      expect(owner.asked).toEqual([]);
      const open = buildServices({ plugins: [server.plugin], engine, device: 'open' });
      await open.services.account.createLocal('Lee');
      await signIn(open, server);
      expect(await open.services.account.current()).toMatchObject({ kind: 'server' });
    });

    it('fails, rather than goes ahead, when the account cannot be reached to ask', async () => {
      const { b, server } = await twoAccounts();
      server.failNext(new AppError('OFFLINE', 'No network.', { retry: 'network-change' }));
      await expect(b.services.account.signOut({ password: ACCOUNT_PASSWORD })).rejects.toMatchObject({ verdict: 'failed' });
      expect(await b.services.account.current()).toMatchObject({ kind: 'server' });
    });

    it('says when the account throttles, and goes no further', async () => {
      const { b, server } = await twoAccounts();
      server.throttleOwner(true);
      await expect(b.services.account.signOut({ password: ACCOUNT_PASSWORD })).rejects.toMatchObject({ verdict: 'throttled' });
      expect(await b.services.account.current()).toMatchObject({ kind: 'server' });
    });

    it('asks the device instead of an account that no longer takes this device’s password', async () => {
      const server = fakeAccountServer({ invite: INVITE });
      const owner = fakeOwnerAuthentication({ available: true, answer: 'verified' });
      const device = buildServices({ plugins: [server.plugin], engine, device: 'refused', owner });
      await device.services.account.createLocal('Lee');
      await signIn(device, server, { signUp: INVITE });
      server.changePassword('changed elsewhere');
      await sync(device);
      expect(await device.services.owner.method()).toEqual({ via: 'device' });
      const asked = owner.asked.length;
      await device.services.account.signOut();
      expect(owner.asked).toHaveLength(asked + 1);
      expect(await device.services.account.current()).toMatchObject({ kind: 'local' });
    });
  });

  describe('the profile limit', () => {
    it('is your server’s, once signed in to it', async () => {
      const { b, server } = pair({ maxProfiles: 3 });
      await b.services.account.createLocal('Sam');
      await signIn(b, server, { signUp: INVITE });
      expect(await b.services.account.maxProfiles()).toBe(3);
      await b.services.profiles.create('Two');
      await b.services.profiles.create('Three');
      await expect(b.services.profiles.create('Four')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });
  });
});
