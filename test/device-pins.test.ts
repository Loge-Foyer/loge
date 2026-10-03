import { credentialsRef, userId, type UserId } from '@loge/api';
import { describe, expect, it } from 'vitest';

import { describePinStatus } from '@/components/labels';
import { devicePinOf, withDevicePin, withoutDevicePin } from '@/services/device-pins';
import type { LocalDatabase } from '@/services/ports';
import { toAppUser } from '@/services/users';

import { ENGINE_PAIRS, signIn, sync, target, twoDevices } from './support/devices';
import { dumpDatabase, ENGINES, reopenable, type Engine } from './support/engines';
import { memoryCredentialStore } from './support/fakes';
import { buildServices } from './support/services';
import { fakeOwnerAuthentication } from './support/sync';

const INVITE = 'GOOD-INVITE';
const alex = userId('alex');

/** The ref of the PIN this device keeps for a profile, if it keeps one. */
const ownRef = async (db: LocalDatabase, id: UserId) => devicePinOf((await db.deviceSettings.get()).pins, id)?.ref;

describe('a PIN a device decides for itself', () => {
  const account = credentialsRef('account-pin');
  const own = credentialsRef('device-pin');

  it('is what a profile asks for there, whatever the account keeps', () => {
    expect(toAppUser({ id: alex, name: 'Alex' }, undefined).pinProtected).toBe(false);
    expect(toAppUser({ id: alex, name: 'Alex', pinCredentialRef: account }, undefined).pinProtected).toBe(true);
    // This device asks for none, though the account keeps one…
    expect(toAppUser({ id: alex, name: 'Alex', pinCredentialRef: account }, { [alex]: {} }).pinProtected).toBe(false);
    // …or asks for its own, though the account keeps none.
    expect(toAppUser({ id: alex, name: 'Alex' }, { [alex]: { ref: own } }).pinProtected).toBe(true);
  });

  it('is read from the device’s own keys alone', () => {
    expect(devicePinOf({}, userId('constructor'))).toBeUndefined();
    expect(devicePinOf(undefined, alex)).toBeUndefined();
  });

  it('leaves no key behind once nothing is decided', () => {
    const decided = withDevicePin({ defaultUserId: alex }, alex, { ref: own });
    expect(decided).toEqual({ defaultUserId: alex, pins: { [alex]: { ref: own } } });
    expect(withoutDevicePin(decided, alex)).toEqual({ defaultUserId: alex });
    expect(withoutDevicePin({ defaultUserId: alex }, alex)).toEqual({ defaultUserId: alex });
  });

  it('says where it applies in one line', () => {
    expect(describePinStatus({ scope: 'account', asks: true, accountPin: true })).toBe('On — the same PIN on every device');
    expect(describePinStatus({ scope: 'account', asks: false, accountPin: false })).toBe('Off');
    expect(describePinStatus({ scope: 'device', asks: true, accountPin: false })).toBe('On — this device’s own PIN');
    expect(describePinStatus({ scope: 'device', asks: false, accountPin: true })).toBe('Off on this device');
  });
});

describe.each(ENGINES)('a PIN this device decides, on %s', (engine: Engine) => {
  async function setUp(options: { readonly owner?: ReturnType<typeof fakeOwnerAuthentication> } = {}) {
    const built = buildServices({ plugins: [], engine, ...(options.owner ? { owner: options.owner } : {}) });
    const sam = await built.services.account.createLocal('Sam');
    const kids = (await built.services.profiles.create('Kids')).id;
    return { ...built, sam, kids };
  }

  it('starts on the account’s, and says so', async () => {
    const { services, sam } = await setUp();
    expect(await services.pins.status(sam)).toEqual({ scope: 'account', asks: false, accountPin: false });
    await services.pins.create(sam, '1234');
    expect(await services.pins.status(sam)).toEqual({ scope: 'account', asks: true, accountPin: true });
  });

  it('keeps this device’s own out of the database and the journal, and asks for it here alone', async () => {
    const { services, db, credentials, sam } = await setUp();
    await services.pins.create(sam, '1234');
    const before = await db.journal.entries();
    expect(await services.pins.setScope(sam, 'device', '1234')).toEqual({ ok: true });
    await services.pins.create(sam, '5937');

    expect(await services.pins.status(sam)).toEqual({ scope: 'device', asks: true, accountPin: true });
    expect(await services.pins.verify(sam, '5937')).toEqual({ ok: true });
    expect(await services.pins.verify(sam, '1234')).toMatchObject({ ok: false, reason: 'wrong' });
    // Nothing of it is the account's: no entry, and the profile's own ref untouched.
    expect(await db.journal.entries()).toEqual(before);
    expect((await db.users.get(sam))?.pinCredentialRef).toBeDefined();
    expect([...credentials.entries.values()]).toContainEqual({ pin: '5937' });
  });

  it('may ask for none here, whatever the account says', async () => {
    const { services, sam } = await setUp();
    await services.pins.create(sam, '1234');
    await services.pins.setScope(sam, 'device', '1234');
    expect(await services.pins.status(sam)).toEqual({ scope: 'device', asks: false, accountPin: true });
    expect((await services.profiles.get(sam))?.pinProtected).toBe(false);
    expect(await services.session.select(sam)).toBe('ready');
  });

  it('changes where it applies only with the PIN asked for now, counting a wrong one', async () => {
    const { services, clock, sam } = await setUp();
    await services.pins.create(sam, '1234');
    await expect(services.pins.setScope(sam, 'device')).rejects.toThrow('PIN asked for now');
    expect(await services.pins.setScope(sam, 'device', '0000')).toEqual({ ok: false, reason: 'wrong', attemptsLeft: 4 });
    expect(await services.pins.status(sam)).toMatchObject({ scope: 'account' });
    for (let miss = 0; miss < 3; miss++) await services.pins.setScope(sam, 'device', '0000');
    expect(await services.pins.setScope(sam, 'device', '0000')).toMatchObject({ ok: false, reason: 'locked' });
    // The lockout covers the right PIN too, until it lifts.
    expect(await services.pins.setScope(sam, 'device', '1234')).toMatchObject({ ok: false, reason: 'locked' });
    clock.advance(30_000);
    expect(await services.pins.setScope(sam, 'device', '1234')).toEqual({ ok: true });
  });

  it('needs nothing to change where it applies while this device asks for none', async () => {
    const { services, sam } = await setUp();
    expect(await services.pins.setScope(sam, 'device')).toEqual({ ok: true });
    expect(await services.pins.setScope(sam, 'account')).toEqual({ ok: true });
    expect(await services.pins.status(sam)).toEqual({ scope: 'account', asks: false, accountPin: false });
  });

  it('gives a changed PIN of its own a new secret, and deletes the old; back to all devices, deletes it', async () => {
    const { services, db, credentials, sam } = await setUp();
    await services.pins.setScope(sam, 'device');
    await services.pins.create(sam, '1111');
    const first = await ownRef(db, sam);
    expect(await services.pins.change(sam, '1111', '2222')).toEqual({ ok: true });
    const second = await ownRef(db, sam);
    expect(second).not.toEqual(first);
    expect(first && credentials.entries.has(first)).toBe(false);

    expect(await services.pins.setScope(sam, 'account', '2222')).toEqual({ ok: true });
    expect((await db.deviceSettings.get()).pins).toBeUndefined();
    expect(second && credentials.entries.has(second)).toBe(false);
    expect(await db.staleSecrets.list()).toEqual([]);
  });

  it('turns its own off and still decides: then it asks for none', async () => {
    const { services, db, credentials, sam } = await setUp();
    await services.pins.setScope(sam, 'device');
    await services.pins.create(sam, '1111');
    const ref = await ownRef(db, sam);
    expect(await services.pins.remove(sam, '1111')).toEqual({ ok: true });
    expect(await services.pins.status(sam)).toEqual({ scope: 'device', asks: false, accountPin: false });
    expect(ref && credentials.entries.has(ref)).toBe(false);
  });

  it('on Forgot PIN, clears only the PIN this device asks for', async () => {
    const owner = fakeOwnerAuthentication({ available: true, answer: 'verified' });
    const { services, sam } = await setUp({ owner });
    await services.pins.create(sam, '1234');
    await services.pins.setScope(sam, 'device', '1234');
    await services.pins.create(sam, '5678');
    expect(await services.pins.forgot(sam)).toBe('verified');
    expect(await services.pins.status(sam)).toEqual({ scope: 'device', asks: false, accountPin: true });
    expect(owner.asked.at(-1)).toContain('on this device');
  });

  it('goes with its profile, and its secret with it', async () => {
    const { services, db, credentials, kids } = await setUp();
    await services.pins.setScope(kids, 'device');
    await services.pins.create(kids, '2468');
    const ref = await ownRef(db, kids);
    await services.profiles.remove(kids);
    expect((await db.deviceSettings.get()).pins).toBeUndefined();
    expect(ref && credentials.entries.has(ref)).toBe(false);
  });

  it('stays out of a backup, and an import takes this device’s own choices away with its account', async () => {
    const a = buildServices({ plugins: [], engine, device: 'a' });
    const smiths = await a.services.account.createLocal('The Smiths');
    await a.services.pins.setScope(smiths, 'device');
    await a.services.pins.create(smiths, '4444');
    const file = await a.services.backup.exportFile();
    const key = await a.services.backup.showKey();

    const b = buildServices({ plugins: [], engine, device: 'b' });
    const someone = await b.services.account.createLocal('Someone else');
    await b.services.pins.setScope(someone, 'device');
    await b.services.pins.create(someone, '5555');
    const theirs = await ownRef(b.db, someone);
    await b.services.backup.completeImport(await b.services.backup.prepareImport(file.bytes, key));

    expect(await b.services.pins.status(smiths)).toEqual({ scope: 'account', asks: false, accountPin: false });
    expect((await b.db.deviceSettings.get()).pins).toBeUndefined();
    expect(theirs && b.credentials.entries.has(theirs)).toBe(false);
    expect(JSON.stringify([...b.credentials.entries.values()])).not.toContain('4444');
  });

  it('decides the gate after a restart, as each choice says', async () => {
    const where = reopenable(engine);
    const credentials = memoryCredentialStore();
    const deviceBound = memoryCredentialStore();
    const launch = () => buildServices({ plugins: [], engine, where, credentials, deviceBound }).services;
    const first = launch();
    const sam = await first.account.createLocal('Sam');
    const kids = (await first.profiles.create('Kids')).id;
    await first.pins.create(sam, '1234');
    await first.pins.setScope(sam, 'device', '1234');
    await first.pins.setScope(kids, 'device');
    await first.pins.create(kids, '2468');
    await first.profiles.setDefault(kids);

    const again = launch();
    await again.session.start();
    expect(again.session.getSnapshot()).toEqual({ kind: 'needs-user-unlock', userId: kids });
    expect(await again.session.unlock(kids, '1234')).toMatchObject({ ok: false, reason: 'wrong' });
    expect(await again.session.unlock(kids, '2468')).toEqual({ ok: true });
    expect((await again.profiles.list()).map((profile) => [profile.name, profile.pinProtected])).toEqual([
      ['Sam', false],
      ['Kids', true],
    ]);
  });
});

describe.each(ENGINE_PAIRS)('a PIN a device decides, with two devices on %s and %s', (first: Engine, second: Engine) => {
  /** A made the account from its own — Sam and Robin — with an invite; B signed in to it. */
  async function onOneAccount() {
    const devices = twoDevices([first, second], { server: { invite: INVITE } });
    const sam = await devices.a.services.account.createLocal('Sam');
    const robin = (await devices.a.services.profiles.create('Robin')).id;
    await signIn(devices.a, devices.server, { signUp: INVITE });
    await signIn(devices.b, devices.server);
    return { ...devices, sam, robin };
  }

  it('locks the device that keeps it, and travels nowhere', async () => {
    const { a, b, server, robin } = await onOneAccount();
    await a.services.pins.setScope(robin, 'device');
    await a.services.pins.create(robin, '2468');
    expect(a.engine.status()).toMatchObject({ pending: 0 });
    await sync(a);
    await sync(b);
    expect(server.account().records.get(`pin/${robin}`)).toBeUndefined();
    expect(JSON.stringify([...server.account().records.values()])).not.toContain('2468');
    expect((await a.services.profiles.get(robin))?.pinProtected).toBe(true);
    expect((await b.services.profiles.get(robin))?.pinProtected).toBe(false);
    expect(await dumpDatabase(first, a.where)).not.toContain('2468');
  });

  it('lets a device ask for none while the account’s PIN locks the others — and come back to it', async () => {
    const { a, b, sam } = await onOneAccount();
    await a.services.pins.create(sam, '1357');
    await sync(a);
    await sync(b);
    expect(await b.services.pins.setScope(sam, 'device', '1357')).toEqual({ ok: true });
    expect((await b.services.profiles.get(sam))?.pinProtected).toBe(false);
    expect((await a.services.profiles.get(sam))?.pinProtected).toBe(true);

    // The account's PIN changes elsewhere: this device still asks for none, and knows there is one.
    expect(await a.services.pins.change(sam, '1357', '8080')).toEqual({ ok: true });
    await sync(a);
    await sync(b);
    expect(await b.services.pins.status(sam)).toEqual({ scope: 'device', asks: false, accountPin: true });

    expect(await b.services.pins.setScope(sam, 'account')).toEqual({ ok: true });
    expect((await b.services.profiles.get(sam))?.pinProtected).toBe(true);
    expect(await b.services.pins.verify(sam, '8080')).toEqual({ ok: true });
  });

  it('goes, with its secret, when the profile is deleted on another device', async () => {
    const { a, b, robin } = await onOneAccount();
    await b.services.pins.setScope(robin, 'device');
    await b.services.pins.create(robin, '4444');
    const ref = await ownRef(b.db, robin);
    await a.services.profiles.remove(robin);
    await sync(a);
    await sync(b);
    expect((await b.db.deviceSettings.get()).pins).toBeUndefined();
    expect(ref && b.credentials.entries.has(ref)).toBe(false);
  });

  it('goes when signing in replaces this device’s account', async () => {
    const devices = twoDevices([first, second], { server: { invite: INVITE } });
    await devices.a.services.account.createLocal('Sam');
    await signIn(devices.a, devices.server, { signUp: INVITE });
    const lee = await devices.b.services.account.createLocal('Lee');
    await devices.b.services.pins.setScope(lee, 'device');
    await devices.b.services.pins.create(lee, '4321');
    const ref = await ownRef(devices.b.db, lee);

    await devices.b.services.account.complete(await devices.b.services.account.prepare(target(devices.server)));
    expect((await devices.b.db.deviceSettings.get()).pins).toBeUndefined();
    expect(ref && devices.b.credentials.entries.has(ref)).toBe(false);
  });
});
