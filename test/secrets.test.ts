import { credentialsRef, userId, type CredentialsRef } from '@sc/api';
import { describe, expect, it } from 'vitest';

import { initialDraft, setSecret, setValue, switchMode } from '@/services/connection-draft';
import type { ConnectionDraft } from '@/services/connections';
import { createSecretJanitor } from '@/services/secrets';
import { createSessions, sessionIdentity } from '@/services/sessions';

import { dumpDatabase, ENGINES, reopenable, type Engine } from './support/engines';
import { memoryCredentialStore, silentLog } from './support/fakes';
import { buildServices, fakeMediaPlugin, movie } from './support/services';

const NEWEST = { by: 'releaseDate', order: 'desc' } as const;

describe.each(ENGINES)('secrets on %s', (engine: Engine) => {
  async function setUp(options: { credentials?: ReturnType<typeof memoryCredentialStore> } = {}) {
    const source = fakeMediaPlugin('fake', { movies: (id) => [movie(id, 'm1', 2020)], signsIn: true });
    const where = reopenable(engine);
    const built = buildServices({ plugins: [source.plugin], engine, where, ...options });
    const kids = await built.services.profiles.create('Kids');
    const alex = await built.services.profiles.create('Alex');
    return { ...built, where, source, kids, alex };
  }

  function sharedDraft(manifest: ReturnType<typeof fakeMediaPlugin>['manifest'], tab: Parameters<typeof setValue>[2]): ConnectionDraft {
    let draft = initialDraft(manifest, 0);
    draft = setValue(manifest, draft, tab, 'fields', 'serverUrl', 'http://home:8096');
    draft = setValue(manifest, draft, tab, 'fields', 'username', 'family');
    return setSecret(draft, tab, 'password', 'family-secret');
  }

  it('keeps every password, PIN and session token out of the database', async () => {
    const { services, source, kids, alex, where, deviceBound } = await setUp();
    await services.pins.create(alex.id, '4821');
    const created = await services.connections.create(source.manifest.id, sharedDraft(source.manifest, kids.id));
    const edit = await services.connections.edit(created.id);
    if (!edit) throw new Error('setup');
    let split = switchMode(source.manifest, sharedDraft(source.manifest, kids.id), 'credentials', kids.id, edit.saved);
    split = setValue(source.manifest, split, alex.id, 'fields', 'username', 'alex');
    split = setSecret(split, alex.id, 'password', 'alex-only-secret');
    await services.connections.update(created.id, split);
    await createSessions(deviceBound).bind(created.id, alex.id, 'identity').write('session-token-7f3a');

    const dump = await dumpDatabase(engine, where);
    for (const secret of ['family-secret', 'alex-only-secret', '4821', 'session-token-7f3a']) expect(dump).not.toContain(secret);
    expect(dump).toContain('alex');
  });

  it('gives a changed PIN a new ref, deletes the old one, and journals the change', async () => {
    const { services, db, credentials, alex } = await setUp();
    await services.pins.create(alex.id, '1111');
    const first = (await db.users.get(alex.id))?.pinCredentialRef;
    await services.pins.change(alex.id, '1111', '2222');
    const second = (await db.users.get(alex.id))?.pinCredentialRef;

    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(first && (await credentials.read(first))).toBeUndefined();
    expect(second && (await credentials.read(second))).toEqual({ pin: '2222' });
    expect(await services.pins.verify(alex.id, '2222')).toEqual({ ok: true });
    // Journaled as the profile's PIN, apart from its name.
    const changes = (await db.journal.entries()).filter((entry) => entry.entityId === alex.id);
    expect(changes.map((entry) => [entry.entity, entry.localVersion])).toEqual([
      ['user', 1],
      ['userPin', 2],
      ['userPin', 3],
    ]);

    await services.pins.remove(alex.id, '2222');
    expect(second && (await credentials.read(second))).toBeUndefined();
    expect((await db.users.get(alex.id))?.pinCredentialRef).toBeUndefined();
    expect((await db.journal.entries()).at(-1)).toMatchObject({ entity: 'userPin', entityId: alex.id, localVersion: 4 });
  });

  it('deletes a stale secret right after the commit, and at the next launch what a crash left queued', async () => {
    const { services, db, credentials, deviceBound, source, kids } = await setUp();
    const created = await services.connections.create(source.manifest.id, sharedDraft(source.manifest, kids.id));
    const before = created.values.credentialsRef;
    await services.connections.update(created.id, setSecret(sharedDraft(source.manifest, kids.id), kids.id, 'password', 'changed'));
    expect(before && (await credentials.read(before))).toBeUndefined();
    expect(await db.staleSecrets.list()).toEqual([]);

    // A crash between the commit and the deletion: the ref is queued, the secret still there.
    const orphan = credentialsRef('orphan-from-a-crash');
    await credentials.write(orphan, { password: 'left-behind' });
    await deviceBound.write(orphan, { value: 'left-behind' });
    await db.staleSecrets.add([orphan]);
    await createSecretJanitor({ db, stores: [credentials, deviceBound], log: silentLog }).drain();
    expect(await credentials.read(orphan)).toBeUndefined();
    expect(await deviceBound.read(orphan)).toBeUndefined();
    expect(await db.staleSecrets.list()).toEqual([]);
  });

  it('takes back a secret it wrote when its transaction cannot commit', async () => {
    // Someone else adds a profile while the save is being planned: the plan no longer holds.
    const written: CredentialsRef[] = [];
    const credentials = memoryCredentialStore();
    let interfere: (() => Promise<void>) | undefined;
    const wrapped = {
      ...credentials,
      entries: credentials.entries,
      read: credentials.read,
      delete: credentials.delete,
      write: async (ref: CredentialsRef, value: Record<string, string>) => {
        written.push(ref);
        await credentials.write(ref, value);
        await interfere?.();
      },
    };
    const { services, db, source, kids } = await setUp({ credentials: wrapped });
    const created = await services.connections.create(source.manifest.id, sharedDraft(source.manifest, kids.id));
    written.length = 0;
    interfere = () => db.users.insert({ id: userId('u-late'), name: 'Late' });

    await expect(
      services.connections.update(created.id, setSecret(sharedDraft(source.manifest, kids.id), kids.id, 'password', 'never-saved')),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(written).toHaveLength(1);
    expect(credentials.entries.has(written[0]!)).toBe(false);
    expect((await db.connections.get(created.id))?.values.credentialsRef).toBe(created.values.credentialsRef);
    expect(created.values.credentialsRef && (await credentials.read(created.values.credentialsRef))).toEqual({ password: 'family-secret' });
  });

  it('never signs in with a password that is no longer on the device', async () => {
    const { services, credentials, source, kids } = await setUp();
    const created = await services.connections.create(source.manifest.id, sharedDraft(source.manifest, kids.id));
    // What an Android restore does: the rows come back, the keychain does not.
    const ref = created.values.credentialsRef;
    if (!ref) throw new Error('setup');
    await credentials.delete(ref);

    const row = await services.media.row(kids.id, { kind: 'movies', sort: NEWEST }, 10);
    expect(row.items).toEqual([]);
    expect(row.sourceErrors).toEqual([expect.objectContaining({ code: 'UNAUTHORIZED', retry: 'never', needsPassword: true })]);
    expect(source.stats.signedInWith).toEqual([]);
    // And the form asks for it again instead of saying it is saved.
    expect((await services.connections.edit(created.id))?.saved.shared.size).toBe(0);
  });

  it('forgets a profile’s sessions, PIN and sign-ins with the profile', async () => {
    const { services, credentials, deviceBound, db, source, kids, alex } = await setUp();
    await services.pins.create(alex.id, '1234');
    const pin = (await db.users.get(alex.id))?.pinCredentialRef;
    const created = await services.connections.create(source.manifest.id, sharedDraft(source.manifest, alex.id));
    const edit = await services.connections.edit(created.id);
    if (!edit) throw new Error('setup');
    await services.connections.update(created.id, switchMode(source.manifest, sharedDraft(source.manifest, alex.id), 'credentials', alex.id, edit.saved));
    const own = (await db.connections.profileValues(created.id)).get(alex.id)?.credentialsRef;
    const values = (await services.sources.forUser(alex.id))[0]?.values;
    if (!values) throw new Error('setup');
    const session = createSessions(deviceBound).bind(created.id, alex.id, sessionIdentity(source.manifest, values));
    await session.write('alex-token');

    await services.profiles.remove(alex.id);
    expect(pin && (await credentials.read(pin))).toBeUndefined();
    expect(own && (await credentials.read(own))).toBeUndefined();
    await expect(session.read()).resolves.toBeUndefined();
    expect(await db.staleSecrets.list()).toEqual([]);
    expect(await services.profiles.get(kids.id)).toBeDefined();
  });
});
