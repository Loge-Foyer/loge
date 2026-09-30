import { AppError } from '@sc/api';
import { describe, expect, it, vi } from 'vitest';

import { signIn, sync, twoDevices } from './support/devices';
import { ENGINES, type Engine } from './support/engines';
import { buildServices } from './support/services';
import { ACCOUNT_PASSWORD, fakeAccountServer, fakeOwnerAuthentication } from './support/sync';

const INVITE = 'GOOD-INVITE';

describe.each(ENGINES)('Forgot PIN on %s', (engine: Engine) => {
  it('asks the device on an account kept here: backing out keeps the PIN, a yes clears it', async () => {
    const owner = fakeOwnerAuthentication({ available: true, answer: 'cancelled' });
    const device = buildServices({ plugins: [], engine, owner });
    const alex = await device.services.account.createLocal('Alex');
    await device.services.pins.create(alex, '1234');
    expect(await device.services.owner.method()).toEqual({ via: 'device' });

    expect(await device.services.pins.forgot(alex)).toBe('cancelled');
    expect((await device.services.profiles.get(alex))?.pinProtected).toBe(true);

    owner.set({ available: true, answer: 'verified' });
    expect(await device.services.pins.forgot(alex)).toBe('verified');
    expect((await device.services.profiles.get(alex))?.pinProtected).toBe(false);
    expect(owner.asked).toHaveLength(2);
  });

  it('is refused where no owner can be asked — a browser with its account kept here', async () => {
    const device = buildServices({ plugins: [], engine });
    const alex = await device.services.account.createLocal('Alex');
    await device.services.pins.create(alex, '1234');
    expect(await device.services.owner.method()).toBeNull();
    expect(await device.services.pins.forgot(alex)).toBe('unavailable');
    expect((await device.services.profiles.get(alex))?.pinProtected).toBe(true);
  });

  it('clears the PIN on every device, journaled like any change', async () => {
    const { a, b, server } = twoDevices([engine, engine], { server: { invite: INVITE } });
    const alex = await a.services.account.createLocal('Alex');
    await a.services.pins.create(alex, '1234');
    await signIn(a, server, { signUp: INVITE });
    await signIn(b, server);
    expect((await b.services.profiles.get(alex))?.pinProtected).toBe(true);
    expect(await a.services.pins.forgot(alex, { password: ACCOUNT_PASSWORD })).toBe('verified');
    await sync(a);
    await sync(b);
    expect((await b.services.profiles.get(alex))?.pinProtected).toBe(false);
  });

  it('lifts a lockout from wrong guesses along with the PIN', async () => {
    const owner = fakeOwnerAuthentication({ available: true, answer: 'verified' });
    const device = buildServices({ plugins: [], engine, owner });
    const alex = await device.services.account.createLocal('Alex');
    await device.services.pins.create(alex, '1234');
    for (let attempt = 0; attempt < 5; attempt += 1) await device.services.pins.verify(alex, '0000');
    expect((await device.services.pins.verify(alex, '1234')).ok).toBe(false);
    await device.services.pins.forgot(alex);
    await device.services.pins.create(alex, '5678');
    expect(await device.services.pins.verify(alex, '5678')).toEqual({ ok: true });
  });

  it('falls back to the device when the account has no owner check of its own', async () => {
    const server = fakeAccountServer({ invite: INVITE, ownerProof: false });
    const owner = fakeOwnerAuthentication({ available: true, answer: 'verified' });
    const device = buildServices({ plugins: [server.plugin], engine, owner });
    const alex = await device.services.account.createLocal('Alex');
    await signIn(device, server, { signUp: INVITE });
    await device.services.pins.create(alex, '1234');
    expect(await device.services.account.current()).toMatchObject({ kind: 'server' });
    expect(await device.services.owner.method()).toEqual({ via: 'device' });
    const asked = owner.asked.length;
    expect(await device.services.pins.forgot(alex)).toBe('verified');
    expect(owner.asked).toHaveLength(asked + 1);
  });
});

describe.each(ENGINES)('Forgot PIN with the account password on %s', (engine: Engine) => {
  /** A phone signed in to your server, whose owner check asks for the account's password; Alex locked with a PIN. */
  async function household() {
    const server = fakeAccountServer({ invite: INVITE });
    const owner = fakeOwnerAuthentication({ available: true, answer: 'verified' });
    const device = buildServices({ plugins: [server.plugin], engine, device: 'phone', owner });
    const alex = await device.services.account.createLocal('Alex');
    await device.services.pins.create(alex, '1234');
    await signIn(device, server, { signUp: INVITE });
    const locked = async () => (await device.services.profiles.get(alex))?.pinProtected;
    return { server, owner, device, alex, locked, asked: owner.asked.length };
  }

  it('asks for the password, keeps the PIN for a wrong one, and clears it for the right one', async () => {
    const { device, alex, locked } = await household();
    expect(await device.services.owner.method()).toMatchObject({ via: 'account', asks: [{ key: 'password' }] });
    expect(await device.services.pins.forgot(alex, { password: 'a guess' })).toBe('refused');
    expect(await locked()).toBe(true);
    expect(await device.services.pins.forgot(alex, { password: ACCOUNT_PASSWORD })).toBe('verified');
    expect(await locked()).toBe(false);
  });

  it('refuses an empty password without asking the account, so it never counts as a wrong try', async () => {
    const { server, device, alex, locked } = await household();
    expect(await device.services.pins.forgot(alex, { password: '' })).toBe('refused');
    expect(await device.services.pins.forgot(alex)).toBe('refused');
    expect(server.calls.owners).toBe(0);
    expect(await locked()).toBe(true);
  });

  it('says so when the account is throttling, and keeps the PIN', async () => {
    const { server, device, alex, locked } = await household();
    server.throttleOwner(true);
    expect(await device.services.pins.forgot(alex, { password: ACCOUNT_PASSWORD })).toBe('throttled');
    expect(await locked()).toBe(true);
  });

  it('fails, rather than asks the device instead, when the account cannot be reached', async () => {
    const { server, owner, device, alex, locked, asked } = await household();
    server.failNext(new AppError('OFFLINE', 'No network.', { retry: 'network-change' }));
    expect(await device.services.pins.forgot(alex, { password: ACCOUNT_PASSWORD })).toBe('failed');
    expect(owner.asked).toHaveLength(asked);
    expect(await locked()).toBe(true);
  });

  it('lets the device answer once the account refuses this device’s saved password', async () => {
    const { server, owner, device, alex, locked, asked } = await household();
    server.changePassword('changed elsewhere');
    await sync(device);
    expect(await device.services.owner.method()).toEqual({ via: 'device' });
    expect(await device.services.pins.forgot(alex)).toBe('verified');
    expect(owner.asked).toHaveLength(asked + 1);
    expect(await locked()).toBe(false);
  });
});

describe.each(ENGINES)('the session gate on %s', (engine: Engine) => {
  const pair = () => twoDevices([engine, engine], { server: { invite: INVITE } });

  it('moves from the first launch to “Who’s watching?” when an account brings profiles', async () => {
    const { a, b, server } = pair();
    await a.services.account.createLocal('Sam');
    await a.services.profiles.create('Robin');
    await signIn(a, server, { signUp: INVITE });
    await b.services.session.start();
    expect(b.services.session.getSnapshot().kind).toBe('needs-account');
    await signIn(b, server);
    // Nobody asks the gate to look again: what the sign-in brought reaches it by itself.
    await vi.waitFor(() => expect(b.services.session.getSnapshot().kind).toBe('needs-user-selection'));
  });

  it('leaves a profile that is gone for “Who’s watching?”', async () => {
    const { a, b, server } = pair();
    const sam = await a.services.account.createLocal('Sam');
    const robin = (await a.services.profiles.create('Robin')).id;
    await signIn(a, server, { signUp: INVITE });
    await signIn(b, server);
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
    const { a, b, server } = pair();
    const sam = await a.services.account.createLocal('Sam');
    await signIn(a, server, { signUp: INVITE });
    await signIn(b, server);
    await b.services.session.start();
    await b.services.session.select(sam);
    await a.services.pins.create(sam, '1234');
    await sync(a);
    await sync(b);
    expect(b.services.session.getSnapshot()).toEqual({ kind: 'ready', userId: sam });
    expect((await b.services.profiles.get(sam))?.pinProtected).toBe(true);
  });

  it('makes the first profile chosen on a device without a default its default', async () => {
    const { a, b, server } = pair();
    const sam = await a.services.account.createLocal('Sam');
    const robin = (await a.services.profiles.create('Robin')).id;
    await signIn(a, server, { signUp: INVITE });
    await signIn(b, server);
    expect(await b.services.profiles.defaultUserId()).toBeUndefined();
    await b.services.session.start();
    await b.services.session.select(robin);
    expect(await b.services.profiles.defaultUserId()).toBe(robin);
    await b.services.session.select(sam);
    expect(await b.services.profiles.defaultUserId()).toBe(robin);
  });
});
