import { describe, expect, it } from 'vitest';

import { signIn, sync, twoDevices } from './support/devices';
import { ENGINES, type Engine } from './support/engines';
import { buildServices } from './support/services';
import { fakeOwnerAuthentication, fakeSyncAccount } from './support/sync';

describe.each(ENGINES)('Forgot PIN on %s', (engine: Engine) => {
  it('asks the account when it can, and clears the PIN only once it says yes', async () => {
    const { a, account } = twoDevices([engine, engine]);
    const alex = (await a.services.profiles.create('Alex')).id;
    await a.services.pins.create(alex, '1234');
    await signIn(a, account);
    expect(await a.services.owner.method()).toBe('account');

    account.refuseOwner(true);
    expect(await a.services.pins.forgot(alex)).toBe('refused');
    expect((await a.services.profiles.get(alex))?.pinProtected).toBe(true);

    account.refuseOwner(false);
    expect(await a.services.pins.forgot(alex)).toBe('verified');
    expect((await a.services.profiles.get(alex))?.pinProtected).toBe(false);
  });

  it('asks the device without an account: backing out keeps the PIN, a yes clears it', async () => {
    const owner = fakeOwnerAuthentication({ available: true, answer: 'cancelled' });
    const device = buildServices({ plugins: [], engine, owner });
    const alex = (await device.services.profiles.create('Alex')).id;
    await device.services.pins.create(alex, '1234');
    expect(await device.services.owner.method()).toBe('device');

    expect(await device.services.pins.forgot(alex)).toBe('cancelled');
    expect((await device.services.profiles.get(alex))?.pinProtected).toBe(true);

    owner.set({ available: true, answer: 'verified' });
    expect(await device.services.pins.forgot(alex)).toBe('verified');
    expect((await device.services.profiles.get(alex))?.pinProtected).toBe(false);
    expect(owner.asked).toHaveLength(2);
  });

  it('is refused where no owner can be asked — a browser without an account', async () => {
    const device = buildServices({ plugins: [], engine });
    const alex = (await device.services.profiles.create('Alex')).id;
    await device.services.pins.create(alex, '1234');
    expect(await device.services.owner.method()).toBeNull();
    expect(await device.services.pins.forgot(alex)).toBe('unavailable');
    expect((await device.services.profiles.get(alex))?.pinProtected).toBe(true);
  });

  it('clears the PIN on every device, journaled like any change', async () => {
    const { a, b, account } = twoDevices([engine, engine]);
    const alex = (await a.services.profiles.create('Alex')).id;
    await a.services.pins.create(alex, '1234');
    await signIn(a, account);
    await signIn(b, account);
    expect((await b.services.profiles.get(alex))?.pinProtected).toBe(true);
    await a.services.pins.forgot(alex);
    await sync(a);
    await sync(b);
    expect((await b.services.profiles.get(alex))?.pinProtected).toBe(false);
  });

  it('lifts a lockout from wrong guesses along with the PIN', async () => {
    const owner = fakeOwnerAuthentication({ available: true, answer: 'verified' });
    const device = buildServices({ plugins: [], engine, owner });
    const alex = (await device.services.profiles.create('Alex')).id;
    await device.services.pins.create(alex, '1234');
    for (let attempt = 0; attempt < 5; attempt += 1) await device.services.pins.verify(alex, '0000');
    expect((await device.services.pins.verify(alex, '1234')).ok).toBe(false);
    await device.services.pins.forgot(alex);
    await device.services.pins.create(alex, '5678');
    expect(await device.services.pins.verify(alex, '5678')).toEqual({ ok: true });
  });

  it('falls back to the device when the account has no owner check of its own', async () => {
    const account = fakeSyncAccount({ noOwnerCheck: true });
    const owner = fakeOwnerAuthentication({ available: true, answer: 'verified' });
    const device = buildServices({ plugins: [account.plugin], engine, owner });
    await signIn(device, account);
    const alex = (await device.services.profiles.create('Alex')).id;
    await device.services.pins.create(alex, '1234');
    expect(await device.services.account.current()).toBeDefined();
    expect(await device.services.owner.method()).toBe('device');
    expect(await device.services.pins.forgot(alex)).toBe('verified');
    expect(owner.asked).toHaveLength(1);
  });
});

describe.each(ENGINES)('the session gate on %s', (engine: Engine) => {
  it('moves from the first launch to "Who’s watching?" when an account brings profiles', async () => {
    const { a, b, account } = twoDevices([engine, engine]);
    await a.services.profiles.create('Sam');
    await signIn(a, account);
    await b.services.session.start();
    expect(b.services.session.getSnapshot().kind).toBe('needs-first-user');
    await signIn(b, account);
    await b.services.session.refresh();
    expect(b.services.session.getSnapshot().kind).toBe('needs-user-selection');
  });

  it('leaves a profile that is gone for "Who’s watching?"', async () => {
    const { a, b, account } = twoDevices([engine, engine]);
    const sam = (await a.services.profiles.create('Sam')).id;
    const robin = (await a.services.profiles.create('Robin')).id;
    await signIn(a, account);
    await signIn(b, account);
    await b.services.session.start();
    await b.services.session.select(sam);
    expect(b.services.session.getSnapshot()).toEqual({ kind: 'ready', userId: sam });

    await a.services.profiles.remove(sam);
    await sync(a);
    await sync(b);
    expect(b.services.session.getSnapshot().kind).toBe('needs-user-selection');
    expect((await b.services.profiles.list()).map((profile) => profile.id)).toEqual([robin]);
  });

  it('never locks the profile in use when its PIN is set on another device', async () => {
    const { a, b, account } = twoDevices([engine, engine]);
    const sam = (await a.services.profiles.create('Sam')).id;
    await signIn(a, account);
    await signIn(b, account);
    await b.services.session.start();
    await b.services.session.select(sam);
    await a.services.pins.create(sam, '1234');
    await sync(a);
    await sync(b);
    expect(b.services.session.getSnapshot()).toEqual({ kind: 'ready', userId: sam });
    expect((await b.services.profiles.get(sam))?.pinProtected).toBe(true);
  });

  it('makes the first profile chosen on a device without a default its default', async () => {
    const { a, b, account } = twoDevices([engine, engine]);
    const sam = (await a.services.profiles.create('Sam')).id;
    const robin = (await a.services.profiles.create('Robin')).id;
    await signIn(a, account);
    await signIn(b, account);
    expect(await b.services.profiles.defaultUserId()).toBeUndefined();
    await b.services.session.start();
    await b.services.session.select(robin);
    expect(await b.services.profiles.defaultUserId()).toBe(robin);
    await b.services.session.select(sam);
    expect(await b.services.profiles.defaultUserId()).toBe(robin);
  });
});
