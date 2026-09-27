import { AppError, isAppError } from '@sc/api';
import { describe, expect, it } from 'vitest';

import { OwnerNotVerifiedError } from '@/services/account';
import { draftOf, initialDraft } from '@/services/connection-draft';

import { accountDraft, mediaDraft, signIn, sync, twoDevices } from './support/devices';
import { ENGINES, type Engine } from './support/engines';
import { buildServices, fakeMediaPlugin } from './support/services';
import { fakeOwnerAuthentication, fakeSyncAccount } from './support/sync';

const layout = { version: 1 as const, rows: [{ id: 'continue', type: 'continue' as const, hidden: true }] };

describe.each(ENGINES)('the account on %s', (engine: Engine) => {
  const pair = () => twoDevices([engine, engine]);

  /** B brought Sam and Robin to the account; A has Lee, and a connection with a saved password. */
  async function bothHaveProfiles() {
    const devices = pair();
    await devices.b.services.profiles.create('Sam');
    await devices.b.services.profiles.create('Robin');
    await signIn(devices.b, devices.account);
    const lee = (await devices.a.services.profiles.create('Lee')).id;
    const home = await devices.a.services.connections.create(devices.media.manifest.id, mediaDraft(devices.media, lee));
    return { ...devices, lee, home };
  }

  describe('joining, when both sides have profiles', () => {
    it('asks, and "Use the account’s profiles" leaves only those — keeping this device’s connections', async () => {
      const { a, account, home } = await bothHaveProfiles();
      const prepared = await a.services.account.prepareSignIn({ pluginId: account.plugin.manifest.id, draft: accountDraft(account) });
      expect(prepared).toMatchObject({ ask: true, accountProfiles: 2, switching: false });
      await a.services.account.completeSignIn(prepared, 'account');

      expect((await a.services.profiles.list()).map((profile) => profile.name).sort()).toEqual(['Robin', 'Sam']);
      const kept = await a.services.connections.edit(home.id);
      expect(kept?.saved.shared.has('password')).toBe(true);
      expect(account.log.some((change) => change.entity === 'connection' && change.operation === 'upsert' && change.data.connectionId === home.id)).toBe(true);
    });

    it('asks, and "Keep both" keeps everyone, sending this device’s along', async () => {
      const { a, b, account, lee } = await bothHaveProfiles();
      await signIn(a, account, 'both');
      expect((await a.services.profiles.list()).map((profile) => profile.name).sort()).toEqual(['Lee', 'Robin', 'Sam']);
      await sync(b);
      expect((await b.services.profiles.get(lee))?.name).toBe('Lee');
    });

    it('does not ask when there is nothing to choose between', async () => {
      const { a, b, account } = pair();
      await b.services.profiles.create('Sam');
      await signIn(b, account);
      // A has no profile at all: nothing of its own would be lost.
      const prepared = await a.services.account.prepareSignIn({ pluginId: account.plugin.manifest.id, draft: accountDraft(account) });
      expect(prepared.ask).toBe(false);
    });
  });

  describe('joining again, after signing out', () => {
    async function signedOutWhileRenamedElsewhere() {
      const devices = pair();
      const alex = (await devices.a.services.profiles.create('Alex')).id;
      await devices.a.services.profiles.create('Kids');
      await signIn(devices.a, devices.account);
      await signIn(devices.b, devices.account);
      await devices.a.services.account.signOut();
      await devices.b.services.profiles.rename(alex, 'Renamed elsewhere');
      await sync(devices.b);
      return { ...devices, alex };
    }

    it('takes what changed in the account meanwhile', async () => {
      const { a, account, alex } = await signedOutWhileRenamedElsewhere();
      await signIn(a, account);
      expect((await a.services.profiles.get(alex))?.name).toBe('Renamed elsewhere');
    });

    it('keeps what this device changed meanwhile, and sends it', async () => {
      const { a, account, alex } = await signedOutWhileRenamedElsewhere();
      await a.services.profiles.rename(alex, 'Mine');
      await signIn(a, account);
      expect((await a.services.profiles.get(alex))?.name).toBe('Mine');
      expect(account.log.filter((change) => change.entity === 'profile').at(-1)).toMatchObject({ data: { name: 'Mine' } });
    });

    it('does not bring back what this device deleted meanwhile, and says so', async () => {
      const { a, b, account } = await signedOutWhileRenamedElsewhere();
      const kids = (await a.services.profiles.list()).find((profile) => profile.name === 'Kids');
      if (!kids) throw new Error('setup');
      await a.services.profiles.remove(kids.id);
      await signIn(a, account);
      expect(await a.services.profiles.get(kids.id)).toBeUndefined();
      await sync(b);
      expect(await b.services.profiles.get(kids.id)).toBeUndefined();
    });
  });

  describe('a sign-in that does not go through', () => {
    it('is tried once, refused for good, and leaves nothing behind', async () => {
      const { a, account, media } = pair();
      const lee = (await a.services.profiles.create('Lee')).id;
      await a.services.connections.create(media.manifest.id, mediaDraft(media, lee));
      const connections = await a.db.connections.list();
      const secrets = a.credentials.entries.size;
      account.refuseSignIn(true);
      const failure = await a.services.account.prepareSignIn({ pluginId: account.plugin.manifest.id, draft: accountDraft(account) }).catch((error: unknown) => error);
      expect(isAppError(failure) && failure.code).toBe('UNAUTHORIZED');
      expect(account.calls.signIns).toBe(1);
      expect(await a.db.connections.list()).toEqual(connections);
      expect(a.credentials.entries.size).toBe(secrets);
    });

    it('saves nothing, PINs included, until it is completed', async () => {
      const { a, b, account } = pair();
      const sam = (await b.services.profiles.create('Sam')).id;
      await b.services.pins.create(sam, '1234');
      await signIn(b, account);
      const prepared = await a.services.account.prepareSignIn({ pluginId: account.plugin.manifest.id, draft: accountDraft(account) });
      expect(await a.services.account.current()).toBeUndefined();
      expect(JSON.stringify([...a.credentials.entries.values()])).not.toContain('1234');
      await a.services.account.completeSignIn(prepared, 'both');
      expect(await a.services.pins.verify(sam, '1234')).toEqual({ ok: true });
    });
  });

  describe('one account per device', () => {
    it('lets no connection form switch a sync role on', async () => {
      const both = fakeSyncAccount({ id: 'both-roles', withMedia: true });
      const device = buildServices({ plugins: [both.plugin], engine, device: 'solo' });
      await device.services.profiles.create('Solo');
      await device.services.devicePlugins.setEnabled(both.plugin.manifest.id, true);
      const created = await device.services.connections.create(both.plugin.manifest.id, {
        ...initialDraft(both.plugin.manifest, 0),
        roles: { media: true, sync: true },
      });
      expect(created.roles).toEqual({ media: true, sync: false });
      const edit = await device.services.connections.edit(created.id);
      if (!edit) throw new Error('setup');
      const updated = await device.services.connections.update(created.id, { ...draftOf(both.plugin.manifest, edit), roles: { media: true, sync: true } });
      expect(updated.roles).toEqual({ media: true, sync: false });
      expect(await device.services.account.current()).toBeUndefined();
    });

    it('switches: the old account gets what it had not yet, then the new one holds everything', async () => {
      const account = fakeSyncAccount();
      const second = fakeSyncAccount({ id: 'second-account' });
      const device = buildServices({ plugins: [account.plugin, second.plugin], engine, device: 'switcher' });
      const lee = (await device.services.profiles.create('Lee')).id;
      await signIn(device, account);
      await device.services.profiles.rename(lee, 'Lee, renamed');

      const prepared = await device.services.account.prepareSignIn({ pluginId: second.plugin.manifest.id, draft: accountDraft(second) });
      expect(prepared.switching).toBe(true);
      await device.services.account.completeSignIn(prepared, 'both');

      expect(account.log.filter((change) => change.entity === 'profile').at(-1)).toMatchObject({ data: { name: 'Lee, renamed' } });
      expect(second.log.some((change) => change.entity === 'profile' && change.operation === 'upsert' && change.data.name === 'Lee, renamed')).toBe(true);
      const withSync = (await device.db.connections.list()).filter((connection) => connection.roles.sync === true);
      expect(withSync.map((connection) => connection.pluginId)).toEqual([second.plugin.manifest.id]);
    });
  });

  describe('signing out', () => {
    it('keeps everything on the device, and lets a connection that was only the account go', async () => {
      const { a, account } = pair();
      const lee = (await a.services.profiles.create('Lee')).id;
      await a.services.homeLayout.update(lee, () => layout.rows);
      await signIn(a, account);
      const id = (await a.services.account.current())?.connection.id;
      if (!id) throw new Error('setup');
      await a.services.account.signOut();
      expect(await a.services.account.current()).toBeUndefined();
      expect(await a.db.syncState.get(id)).toBeUndefined();
      expect(await a.db.connections.get(id)).toBeUndefined();
      expect(await a.services.homeLayout.rows(lee)).toEqual(layout.rows);
      expect((await a.db.deviceSettings.get()).leftAccountAt).toBeGreaterThan(0);
    });

    it('keeps a connection that also serves media, with its sync role off', async () => {
      const account = fakeSyncAccount({ id: 'both-roles', withMedia: true });
      const device = buildServices({ plugins: [account.plugin], engine, device: 'dual' });
      await device.services.profiles.create('Lee');
      await device.services.devicePlugins.setEnabled(account.plugin.manifest.id, true);
      const existing = await device.services.connections.create(account.plugin.manifest.id, initialDraft(account.plugin.manifest, 0));
      const edit = await device.services.connections.edit(existing.id);
      if (!edit) throw new Error('setup');
      const prepared = await device.services.account.prepareSignIn({ connectionId: existing.id, draft: draftOf(account.plugin.manifest, edit) });
      await device.services.account.completeSignIn(prepared, 'both');
      expect((await device.db.connections.get(existing.id))?.roles).toEqual({ media: true, sync: true });
      await device.services.account.signOut();
      expect((await device.db.connections.get(existing.id))?.roles).toEqual({ media: true, sync: false });
    });

    it('is refused a connection removal while it is the account', async () => {
      const { a, account } = pair();
      await signIn(a, account);
      const id = (await a.services.account.current())?.connection.id;
      if (!id) throw new Error('setup');
      await expect(a.services.connections.remove(id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });
  });

  describe('an account that refuses', () => {
    it('is parked, and "Sync now" does not try the same sign-in again', async () => {
      const { a, account } = pair();
      await signIn(a, account);
      account.refuseSignIn(true);
      await sync(a);
      expect(a.engine.status()).toMatchObject({ phase: 'needs-sign-in', problem: { code: 'UNAUTHORIZED' } });
      const pulls = account.calls.pulls;
      await a.services.sync.now();
      expect(account.calls.pulls).toBe(pulls);
    });

    it('is signed in to again with new details, and runs again', async () => {
      const { a, account } = pair();
      await signIn(a, account);
      account.refuseSignIn(true);
      await sync(a);
      account.refuseSignIn(false);
      const current = await a.services.account.current();
      if (!current) throw new Error('setup');
      const prepared = await a.services.account.prepareSignIn({ connectionId: current.connection.id });
      expect(prepared.again).toBe(true);
      await a.services.account.completeSignIn(prepared, 'both');
      expect(a.engine.status().phase).toBe('synced');
    });

    it('is signed in to again without the owner check, and with nothing changed but its passwords', async () => {
      const { a, account } = pair();
      await a.services.profiles.create('Lee');
      await signIn(a, account);
      const current = await a.services.account.current();
      if (!current) throw new Error('setup');
      const before = current.connection.values.fields;
      // Refused as a changed password is: the account cannot vouch for the owner either.
      account.refuseSignIn(true);
      account.refuseOwner(true);
      await sync(a);
      account.refuseSignIn(false);

      const edit = await a.services.connections.edit(current.connection.id);
      if (!edit) throw new Error('setup');
      const stored = draftOf(account.plugin.manifest, edit);
      const elsewhere = { ...stored, shared: { ...stored.shared, fields: { ...stored.shared.fields, server: 'https://elsewhere.example' } } };
      const prepared = await a.services.account.prepareSignIn({ connectionId: current.connection.id, draft: elsewhere });
      await a.services.account.completeSignIn(prepared, 'both');

      expect((await a.services.account.current())?.connection.values.fields).toEqual(before);
      expect(a.engine.status().phase).toBe('synced');
    });

    it('shows as unavailable in a build without its plugin, and can still be signed out of', async () => {
      const { a, account } = pair();
      await signIn(a, account);
      const withoutIt = buildServices({ plugins: [fakeMediaPlugin('fake').plugin], engine, device: 'a', where: a.where, credentials: a.credentials, deviceBound: a.deviceBound });
      expect((await withoutIt.services.account.current())?.available).toBe(false);
      await withoutIt.engine.run();
      expect(withoutIt.engine.status().phase).toBe('unavailable');
      await withoutIt.services.account.signOut();
      expect(await withoutIt.services.account.current()).toBeUndefined();
    });
  });

  describe('the owner check', () => {
    it('guards signing in on a device with profiles', async () => {
      const account = fakeSyncAccount();
      const owner = fakeOwnerAuthentication({ available: true, answer: 'refused' });
      const device = buildServices({ plugins: [account.plugin], engine, device: 'guarded', owner });
      await device.services.profiles.create('Lee');
      await expect(
        device.services.account.prepareSignIn({ pluginId: account.plugin.manifest.id, draft: accountDraft(account) }),
      ).rejects.toBeInstanceOf(OwnerNotVerifiedError);
      expect(account.calls.signIns).toBe(0);
      owner.set({ available: true, answer: 'cancelled' });
      await expect(
        device.services.account.prepareSignIn({ pluginId: account.plugin.manifest.id, draft: accountDraft(account) }),
      ).rejects.toMatchObject({ verdict: 'cancelled' });
    });

    it('is not asked at first launch, and goes ahead where no owner can be asked', async () => {
      const account = fakeSyncAccount();
      const owner = fakeOwnerAuthentication({ available: true, answer: 'refused' });
      const first = buildServices({ plugins: [account.plugin], engine, device: 'fresh', owner });
      await signIn(first, account);
      expect(owner.asked).toEqual([]);
      const open = buildServices({ plugins: [account.plugin], engine, device: 'open' });
      await open.services.profiles.create('Lee');
      await signIn(open, account);
      expect(await open.services.account.current()).toBeDefined();
    });

    it('asks the account itself, when it can be asked, before signing out', async () => {
      const { a, account } = pair();
      await a.services.profiles.create('Lee');
      await signIn(a, account);
      account.refuseOwner(true);
      await expect(a.services.account.signOut()).rejects.toMatchObject({ verdict: 'refused' });
      expect(await a.services.account.current()).toBeDefined();
      account.refuseOwner(false);
      await a.services.account.signOut();
      expect(await a.services.account.current()).toBeUndefined();
    });

    it('fails, rather than goes ahead, when the account cannot be reached to ask', async () => {
      const { a, account } = pair();
      await a.services.profiles.create('Lee');
      await signIn(a, account);
      expect(await a.services.owner.method()).toBe('account');
      // A network failure is not a yes.
      account.failNext(new AppError('OFFLINE', 'No network.'));
      await expect(a.services.account.signOut()).rejects.toMatchObject({ verdict: 'failed' });
      expect(await a.services.account.current()).toBeDefined();
    });
  });
});
