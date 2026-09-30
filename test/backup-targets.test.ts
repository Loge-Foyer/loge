import { describe, expect, it, vi } from 'vitest';

import { readHeader } from '@/services/backup/container';
import { initialDraft } from '@/services/connection-draft';

import { fakeBackupTarget, type FakeBackupTarget } from './support/backup-target';
import { signIn } from './support/devices';
import { ENGINES, type Engine } from './support/engines';
import { buildServices } from './support/services';
import { fakeAccountServer } from './support/sync';

type Device = ReturnType<typeof buildServices>;

/** A device's backups, kept on this target. */
async function keepBackupsOn(device: Device, target: FakeBackupTarget) {
  return device.services.connections.create(target.plugin.manifest.id, initialDraft(target.plugin.manifest, 0));
}

function onlyFile(target: FakeBackupTarget) {
  const [file, ...more] = [...target.files.values()];
  if (!file || more.length > 0) throw new Error(`Expected one file, found ${target.files.size}.`);
  return file;
}

const generationOf = (bytes: Uint8Array) => {
  const header = readHeader(bytes);
  if (typeof header === 'string') throw new Error(header);
  return header.generation;
};

describe.each(ENGINES)('backup targets on %s', (engine: Engine) => {
  /** A made the account and exported it; B imported that file: two devices holding the same account, one target between them. */
  async function twoDevicesOneAccount() {
    const target = fakeBackupTarget();
    const a = buildServices({ plugins: [target.plugin], engine, device: 'a' });
    const smiths = await a.services.account.createLocal('The Smiths');
    const file = await a.services.backup.exportFile();
    const key = await a.services.backup.showKey();
    const b = buildServices({ plugins: [target.plugin], engine, device: 'b' });
    await b.services.backup.completeImport(await b.services.backup.prepareImport(file.bytes, key));
    const onA = await keepBackupsOn(a, target);
    const onB = await keepBackupsOn(b, target);
    return { target, a, b, smiths, onA, onB };
  }

  it('save the account to a target, and again over their own file', async () => {
    const target = fakeBackupTarget();
    const device = buildServices({ plugins: [target.plugin], engine });
    const smiths = await device.services.account.createLocal('The Smiths');
    const connection = await keepBackupsOn(device, target);

    await device.services.backupTargets.saveNow();
    const first = onlyFile(target);
    expect(first.stat.name).toMatch(/^streaming-center-[0-9a-f]{8}\.scbackup$/);
    expect(generationOf(first.bytes)).toBe(1);
    expect(device.services.backupTargets.status()).toMatchObject([{ connectionId: connection.id, phase: 'saved' }]);

    await device.services.profiles.rename(smiths, 'The Smiths, renamed');
    await device.services.backupTargets.saveNow();
    expect(generationOf(onlyFile(target).bytes)).toBe(2);
    expect(target.calls.writes).toBe(2);
  });

  it('ask, rather than overwrite, when another device changed the file — and keep this device’s when told', async () => {
    const { target, a, b, onA, onB } = await twoDevicesOneAccount();
    await a.services.backupTargets.saveNow();
    const saved = onlyFile(target).stat.etag;

    await b.services.backupTargets.saveNow();
    expect(b.services.backupTargets.status()).toMatchObject([{ connectionId: onB.id, phase: 'conflict' }]);
    expect(onlyFile(target).stat.etag).toBe(saved);

    await b.services.backupTargets.resolve(onB.id, 'mine');
    expect(b.services.backupTargets.status()).toMatchObject([{ phase: 'saved' }]);
    expect(onlyFile(target).stat.etag).not.toBe(saved);
    // Now A has not seen the file there: it asks too.
    await a.services.backupTargets.saveNow();
    expect(a.services.backupTargets.status()).toMatchObject([{ connectionId: onA.id, phase: 'conflict' }]);
  });

  it('open theirs: the file there replaces this device’s account, and saving goes on from it', async () => {
    const { target, a, b, smiths, onB } = await twoDevicesOneAccount();
    await a.services.profiles.rename(smiths, 'Renamed on A');
    await a.services.backupTargets.saveNow();
    await b.services.profiles.rename(smiths, 'Renamed on B');
    await b.services.backupTargets.saveNow();
    expect(b.services.backupTargets.status()).toMatchObject([{ phase: 'conflict' }]);

    await b.services.backupTargets.resolve(onB.id, 'theirs');
    expect((await b.services.profiles.get(smiths))?.name).toBe('Renamed on A');
    expect(b.services.backupTargets.status()).toMatchObject([{ phase: 'saved' }]);
    await b.services.profiles.rename(smiths, 'Renamed on B, after');
    await b.services.backupTargets.saveNow();
    expect(b.services.backupTargets.status()).toMatchObject([{ phase: 'saved' }]);
    expect(target.files.size).toBe(1);
  });

  it('keep both: this device’s account becomes one of its own, saved beside theirs', async () => {
    const { target, a, b, onB } = await twoDevicesOneAccount();
    await a.services.backupTargets.saveNow();
    const theirs = onlyFile(target);
    await b.services.backupTargets.saveNow();
    const before = (await b.services.account.current())?.id;

    await b.services.backupTargets.resolve(onB.id, 'both');
    expect((await b.services.account.current())?.id).not.toBe(before);
    expect(target.files.size).toBe(2);
    expect(target.files.get(theirs.stat.name)?.stat.etag).toBe(theirs.stat.etag);
    expect(b.services.backupTargets.status()).toMatchObject([{ phase: 'saved' }]);
  });

  it('save a moment after a change', async () => {
    const target = fakeBackupTarget();
    const device = buildServices({ plugins: [target.plugin], engine, backupDebounceMs: 5 });
    const smiths = await device.services.account.createLocal('The Smiths');
    await keepBackupsOn(device, target);
    device.services.backupTargets.start();
    try {
      await device.services.profiles.rename(smiths, 'Renamed');
      await vi.waitFor(() => expect(target.calls.writes).toBe(1));
    } finally {
      device.services.backupTargets.stop();
    }
  });

  it('save on going to the background when something changed, and not when nothing did', async () => {
    const target = fakeBackupTarget();
    // Long enough that only going to the background can save.
    const device = buildServices({ plugins: [target.plugin], engine, backupDebounceMs: 60_000 });
    const smiths = await device.services.account.createLocal('The Smiths');
    await keepBackupsOn(device, target);
    device.services.backupTargets.start();
    try {
      await device.services.profiles.rename(smiths, 'Renamed');
      expect(target.calls.writes).toBe(0);
      device.activity.set(false);
      await vi.waitFor(() => expect(target.calls.writes).toBe(1));
      device.activity.set(true);
      device.activity.set(false);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(target.calls.writes).toBe(1);
    } finally {
      device.services.backupTargets.stop();
    }
  });

  it('save over the file for an account on your server: its devices hold the same account', async () => {
    const target = fakeBackupTarget();
    const server = fakeAccountServer({ invite: 'GOOD-INVITE' });
    const a = buildServices({ plugins: [server.plugin, target.plugin], engine, device: 'a' });
    await a.services.account.createLocal('The Smiths');
    await signIn(a, server, { signUp: 'GOOD-INVITE' });
    const b = buildServices({ plugins: [server.plugin, target.plugin], engine, device: 'b' });
    await signIn(b, server);
    await keepBackupsOn(a, target);
    await keepBackupsOn(b, target);

    await a.services.backupTargets.saveNow();
    await b.services.backupTargets.saveNow();
    expect(a.services.backupTargets.status()).toMatchObject([{ phase: 'saved' }]);
    expect(b.services.backupTargets.status()).toMatchObject([{ phase: 'saved' }]);
    expect(target.files.size).toBe(1);
    expect(target.calls.writes).toBe(2);
  });
});
