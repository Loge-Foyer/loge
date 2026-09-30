import { connectionId, encodeUtf8, pluginId, userId, type AccountRecord } from '@sc/api';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';

import { createSqlJsBackup } from '@/persistence/backup/sql-js';
import { OwnerNotVerifiedError } from '@/services/account';
import { createBackupService } from '@/services/backup';
import { deriveBackupKeys, HEADER_BYTES, MAX_BACKUP_BYTES, openBackup, sealBackup } from '@/services/backup/container';
import { readBackupDatabase, writeBackupDatabase } from '@/services/backup/database';
import { decodeBase32, encodeBase32, formatBackupKey, parseBackupKey } from '@/services/backup/key';

import { testCrypto } from './support/crypto';
import { mediaDraft, signIn } from './support/devices';
import { dumpDatabase, ENGINES, reopenable, type Engine } from './support/engines';
import { buildServices, fakeMediaPlugin } from './support/services';
import { ACCOUNT_PASSWORD, fakeAccountServer, fakeOwnerAuthentication } from './support/sync';

// sql.js on Node stands in for expo-sqlite and for the browser alike: the file is the same SQLite.
const sql = createSqlJsBackup(() => initSqlJs());
const crypto = testCrypto();
const layout = { version: 1 as const, rows: [{ id: 'continue', type: 'continue' as const, hidden: true }] };

type Device = ReturnType<typeof buildServices>;

function backupOf(device: Device) {
  return createBackupService({
    db: device.db,
    deviceBound: device.deviceBound,
    crypto,
    sql,
    parts: device.parts,
    catalog: device.services.catalog,
    owner: device.services.owner,
    account: device.services.account,
    engine: device.engine,
    scheduler: device.scheduler,
    lock: device.lock,
    janitor: device.janitor,
    clock: device.clock,
    identity: async () => {
      const { appVersion, deviceKey } = await device.identity.identity();
      return { appVersion, deviceKey };
    },
  });
}

describe('the backup key', () => {
  it('is 20 bytes shown as nine groups of four, the last a checksum, and reads back however it is typed', async () => {
    const key = Uint8Array.from({ length: 20 }, (_, index) => (index * 37 + 11) % 256);
    expect(decodeBase32(encodeBase32(key))).toEqual(key);
    const shown = await formatBackupKey(key, crypto.sha256);
    expect(shown).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){8}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(await parseBackupKey(shown, crypto.sha256)).toEqual(key);
    const sloppy = shown.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    expect(await parseBackupKey(sloppy, crypto.sha256)).toEqual(key);
  });

  it('tells a mistyped key from something that is no key at all', async () => {
    const shown = await formatBackupKey(new Uint8Array(20).fill(7), crypto.sha256);
    const typo = `${shown.startsWith('Z') ? 'Y' : 'Z'}${shown.slice(1)}`;
    expect(await parseBackupKey(typo, crypto.sha256)).toBe('mistyped');
    expect(await parseBackupKey(shown.slice(0, -1), crypto.sha256)).toBe('malformed');
    expect(await parseBackupKey('not a key', crypto.sha256)).toBe('malformed');
  });
});

describe('the file around the database', () => {
  const header = { schemaVersion: 1, lineage: new Uint8Array(16).fill(1), generation: 7, writer: new Uint8Array(16).fill(2), createdAt: 1_790_000_000_123 };
  const database = encodeUtf8('the database, serialized');
  const keysOf = (fill: number) => deriveBackupKeys(new Uint8Array(20).fill(fill), crypto);

  it('opens with its key, and gives its header back', async () => {
    const keys = await keysOf(1);
    const file = await sealBackup(crypto, keys, header, database);
    expect(file.length).toBe(HEADER_BYTES + database.length + 16);
    const opened = await openBackup(crypto, keys, file);
    if (typeof opened === 'string') throw new Error(opened);
    expect(opened.database).toEqual(database);
    expect(opened.header).toMatchObject({ formatVersion: 1, schemaVersion: 1, generation: 7, createdAt: header.createdAt });
  });

  it('refuses another key, a byte changed anywhere, a stranger, and a newer format', async () => {
    const keys = await keysOf(1);
    const file = await sealBackup(crypto, keys, header, database);
    expect(await openBackup(crypto, await keysOf(2), file)).toBe('wrong-key');
    // The generation, the writer, the nonce, the ciphertext and the tag: nothing changes unnoticed.
    for (const at of [33, 40, 70, HEADER_BYTES + 2, file.length - 1]) {
      const changed = file.slice();
      changed[at] = (changed[at] ?? 0) ^ 1;
      expect(await openBackup(crypto, keys, changed), `byte ${at}`).toBe('damaged');
    }
    const stranger = file.slice();
    stranger[0] = 0x50;
    expect(await openBackup(crypto, keys, stranger)).toBe('not-a-backup');
    expect(await openBackup(crypto, keys, file.subarray(0, 50))).toBe('not-a-backup');
    const newer = file.slice();
    newer[5] = 2;
    expect(await openBackup(crypto, keys, newer)).toBe('newer');
  });
});

describe('the database inside', () => {
  const sam = userId('u-sam');
  const home = connectionId('c-home');
  const records: AccountRecord[] = [
    { kind: 'profile', key: sam, deleted: false, data: { userId: sam, name: 'Sam' } },
    { kind: 'pin', key: sam, deleted: false, data: { userId: sam, pin: '1234' } },
    { kind: 'preference', key: `${sam}/homeLayout`, deleted: false, data: { userId: sam, name: 'homeLayout', value: layout } },
    {
      kind: 'connection',
      key: home,
      deleted: false,
      data: {
        connectionId: home,
        pluginId: pluginId('sources/jellyfin'),
        label: 'Home',
        enabled: true,
        perProfile: 'credentials',
        fields: { serverUrl: 'http://home:8096' },
        settings: { libraries: { mode: 'only', ids: ['films'] } },
        secretKeys: ['password'],
        secrets: { password: 'family-secret' },
      },
    },
    {
      kind: 'profileValues',
      key: `${home}/${sam}`,
      deleted: false,
      data: { connectionId: home, userId: sam, off: false, fields: { username: 'sam' }, settings: {}, secretKeys: ['password'], secrets: { password: 'sam-secret' } },
    },
  ];
  const contents = { lineage: 'account-1', accountName: 'The Smiths', appVersion: '1.0.0', records };

  it('holds the account’s records, and gives them back as they went in', async () => {
    expect(await readBackupDatabase(sql, await writeBackupDatabase(sql, contents))).toEqual(contents);
  });

  it('refuses what it cannot trust: not SQLite, another SQLite file, a newer schema, a row the contract refuses', async () => {
    expect(await readBackupDatabase(sql, encodeUtf8('not a database at all'))).toBe('damaged');

    const plain = await sql.create();
    await plain.exec('CREATE TABLE t (x)');
    const other = await plain.serialize();
    await plain.close();
    expect(await readBackupDatabase(sql, other)).toBe('damaged');

    const later = await sql.create();
    await later.exec(`PRAGMA application_id = ${0x5343424b}; PRAGMA user_version = 2; CREATE TABLE meta (key TEXT, value TEXT);`);
    const newer = await later.serialize();
    await later.close();
    expect(await readBackupDatabase(sql, newer)).toBe('newer');

    const edited = await sql.open(await writeBackupDatabase(sql, contents));
    await edited.run("UPDATE pins SET pin = 'abcd'");
    const tampered = await edited.serialize();
    await edited.close();
    expect(await readBackupDatabase(sql, tampered)).toBe('damaged');
  });
});

describe.each(ENGINES)('backups on %s', (engine: Engine) => {
  const media = fakeMediaPlugin('fake', { signsIn: true });

  /** The Smiths on A, with a PIN, a layout and a source; B, a device of its own that the backup replaces. */
  async function twoDevices() {
    const a = buildServices({ plugins: [media.plugin], engine, device: 'a', where: reopenable(engine) });
    const smiths = await a.services.account.createLocal('The Smiths');
    const kim = (await a.services.profiles.create('Kim')).id;
    await a.services.pins.create(kim, '9731');
    await a.services.homeLayout.update(smiths, () => layout.rows);
    const home = await a.services.connections.create(media.manifest.id, mediaDraft(media, smiths));

    const where = reopenable(engine);
    const b = buildServices({ plugins: [media.plugin], engine, device: 'b', where });
    const someone = await b.services.account.createLocal('Someone else');
    const theirs = await b.services.connections.create(media.manifest.id, mediaDraft(media, someone, 'their-secret'));
    return { a, b, where, smiths, kim, home, theirs };
  }

  it('carry the whole account to another device — every password into its keychain, never its database', async () => {
    const { a, b, where, smiths, kim, home, theirs } = await twoDevices();
    const file = await backupOf(a).exportFile();
    expect(file.name).toMatch(/^streaming-center-the-smiths-\d{4}-\d{2}-\d{2}\.scbackup$/);
    expect(Buffer.from(file.bytes).toString('latin1')).not.toContain('family-secret');
    const key = await backupOf(a).showKey();

    const prepared = await backupOf(b).prepareImport(file.bytes, key);
    expect(prepared).toMatchObject({ accountName: 'The Smiths', profiles: ['The Smiths', 'Kim'], connections: 1 });
    // Nothing is replaced until the import is completed.
    expect(await b.services.account.current()).toMatchObject({ name: 'Someone else' });
    await backupOf(b).completeImport(prepared);

    expect(await b.services.account.current()).toMatchObject({ kind: 'local', name: 'The Smiths', id: (await a.services.account.current())?.id });
    expect((await b.services.profiles.list()).map((profile) => profile.id)).toEqual([smiths, kim]);
    expect(await b.services.pins.verify(kim, '9731')).toEqual({ ok: true });
    expect(await b.services.homeLayout.rows(smiths)).toEqual(layout.rows);
    await expect(b.services.connections.probeSecrets(media.manifest.id, home.id, 'shared', {})).resolves.toEqual({ password: 'family-secret' });
    expect(await b.db.connections.get(theirs.id)).toBeUndefined();
    expect(JSON.stringify([...b.credentials.entries.values()])).not.toContain('their-secret');
    const dump = await dumpDatabase(engine, where);
    for (const secret of ['family-secret', '9731']) expect(dump).not.toContain(secret);
    // The key that opened it is this device's now: one key for the account.
    expect(await backupOf(b).showKey()).toBe(key);
  });

  it('refuse — before anything changes — another key, a mistyped one, and a file too large to read', async () => {
    const { a, b } = await twoDevices();
    const file = await backupOf(a).exportFile();
    const key = await backupOf(a).showKey();
    const another = await formatBackupKey(new Uint8Array(20).fill(9), crypto.sha256);
    await expect(backupOf(b).prepareImport(file.bytes, another)).rejects.toMatchObject({ problem: 'wrong-key' });
    await expect(backupOf(b).prepareImport(file.bytes, `${key.slice(0, -1)}${key.endsWith('0') ? '1' : '0'}`)).rejects.toMatchObject({ problem: 'mistyped' });
    let read = false;
    const huge = { name: 'huge.scbackup', size: MAX_BACKUP_BYTES + 1, read: async () => ((read = true), file.bytes) };
    await expect(backupOf(b).prepareImport(huge, key)).rejects.toMatchObject({ problem: 'too-large' });
    expect(read).toBe(false);
    expect(await b.services.account.current()).toMatchObject({ name: 'Someone else' });
  });

  it('show the key only to the owner, and the same key every time', async () => {
    const owner = fakeOwnerAuthentication({ available: true, answer: 'refused' });
    const device = buildServices({ plugins: [], engine, owner });
    await device.services.account.createLocal('Lee');
    await expect(backupOf(device).showKey()).rejects.toBeInstanceOf(OwnerNotVerifiedError);
    expect(await backupOf(device).hasKey()).toBe(false);
    owner.set({ available: true, answer: 'verified' });
    const key = await backupOf(device).showKey();
    expect(await backupOf(device).showKey()).toBe(key);
    expect(await backupOf(device).hasKey()).toBe(true);
  });

  it('sign out of your server first, then replace the account with a local one', async () => {
    const server = fakeAccountServer({ invite: 'GOOD-INVITE' });
    const a = buildServices({ plugins: [server.plugin, media.plugin], engine, device: 'a' });
    await a.services.account.createLocal('The Smiths');
    await signIn(a, server, { signUp: 'GOOD-INVITE' });
    const file = await backupOf(a).exportFile();
    const key = await backupOf(a).showKey({ password: ACCOUNT_PASSWORD });

    const b = buildServices({ plugins: [server.plugin, media.plugin], engine, device: 'b' });
    await signIn(b, server);
    const prepared = await backupOf(b).prepareImport(file.bytes, key);
    await backupOf(b).completeImport(prepared, { password: ACCOUNT_PASSWORD });
    expect(server.calls.signOuts).toBe(1);
    // A backup of an account on your server keeps its name, as signing out does.
    expect(await b.services.account.current()).toMatchObject({ kind: 'local', name: 'sam on the fake server' });
    expect((await b.services.profiles.list()).map((profile) => profile.name)).toEqual(['The Smiths']);
  });
});
