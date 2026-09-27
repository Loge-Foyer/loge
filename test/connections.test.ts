import { describe, expect, it } from 'vitest';

import { draftOf, initialDraft, setProfileOff, setSecret, setValue, switchMode } from '@/services/connection-draft';
import { InvalidDraftError, savedSecretsOf, type ConnectionDraft } from '@/services/connections';

import { ENGINES, type Engine } from './support/engines';
import { buildServices, fakeMediaPlugin } from './support/services';

// The multi-row writes live here, so they run on both engines: IndexedDB
// commits a transaction that waits on anything but itself, SQLite does not.
describe.each(ENGINES)('on %s', (engine: Engine) => {
  async function setUp() {
    const source = fakeMediaPlugin('fake');
    const built = buildServices({ plugins: [source.plugin], engine });
    const { services } = built;
    const kids = await services.profiles.create('Kids');
    const alex = await services.profiles.create('Alex');
    await services.devicePlugins.setEnabled(source.manifest.id, true);
    return { ...built, source, services, kids, alex };
  }

  function sharedDraft(manifest: ReturnType<typeof fakeMediaPlugin>['manifest'], tab: Parameters<typeof setValue>[2]): ConnectionDraft {
    let draft = initialDraft(manifest, 0);
    draft = setValue(manifest, draft, tab, 'fields', 'serverUrl', 'http://home:8096');
    draft = setValue(manifest, draft, tab, 'fields', 'username', 'family');
    return setSecret(draft, tab, 'password', 'family-secret');
  }

  describe('connections', () => {
    it('keeps passwords out of every repository row', async () => {
      const { services, db, source, kids } = await setUp();
      const connection = await services.connections.create(source.manifest.id, sharedDraft(source.manifest, kids.id));
      const stored = await db.connections.get(connection.id);
      expect(JSON.stringify(stored)).not.toContain('family-secret');
      expect(stored?.values.secretKeys).toEqual(['password']);
      expect(stored?.values.credentialsRef).toBeDefined();
    });

    it('refuses a draft whose shared values are incomplete', async () => {
      const { services, source } = await setUp();
      await expect(services.connections.create(source.manifest.id, initialDraft(source.manifest, 0))).rejects.toBeInstanceOf(
        InvalidDraftError,
      );
    });

    it('rotates the credentials ref when a password changes, and drops the old secret', async () => {
      const { services, credentials, source, kids } = await setUp();
      const draft = sharedDraft(source.manifest, kids.id);
      const keepSaved = { ...draft, shared: { ...draft.shared, secrets: {} } };
      const created = await services.connections.create(source.manifest.id, draft);
      const before = created.values.credentialsRef;
      if (!before) throw new Error('no secret saved');

      // Nothing typed, or the same value typed again: the secret did not change, so neither does the ref.
      expect((await services.connections.update(created.id, keepSaved)).values.credentialsRef).toBe(before);
      expect((await services.connections.update(created.id, draft)).values.credentialsRef).toBe(before);

      const rotated = await services.connections.update(created.id, setSecret(draft, kids.id, 'password', 'new-secret'));
      const after = rotated.values.credentialsRef;
      expect(after).toBeDefined();
      expect(after).not.toBe(before);
      expect(await credentials.read(before)).toBeUndefined();
      expect(after && (await credentials.read(after))).toEqual({ password: 'new-secret' });
    });

    it('moves the saved login to the profile being edited when switching to credentials', async () => {
      const { services, db, credentials, source, kids, alex } = await setUp();
      const created = await services.connections.create(source.manifest.id, sharedDraft(source.manifest, kids.id));
      const edit = await services.connections.edit(created.id);
      if (!edit) throw new Error('setup');
      const draft = switchMode(source.manifest, { ...sharedDraft(source.manifest, kids.id), shared: { ...sharedDraft(source.manifest, kids.id).shared, secrets: {} } }, 'credentials', kids.id, edit.saved);
      await services.connections.update(created.id, draft);

      const rows = await db.connections.profileValues(created.id);
      expect(rows.get(kids.id)?.fields).toEqual({ username: 'family' });
      const ref = rows.get(kids.id)?.credentialsRef;
      expect(ref && (await credentials.read(ref))).toEqual({ password: 'family-secret' });
      expect(rows.has(alex.id)).toBe(false);
      // The shared secret is gone: nothing is kept that no profile uses.
      const connection = await db.connections.get(created.id);
      expect(connection?.values.credentialsRef).toBeUndefined();
      expect(connection?.values.fields).toEqual({ serverUrl: 'http://home:8096' });
    });

    it('lists which profiles each connection is live for', async () => {
      const { services, source, kids, alex } = await setUp();
      const created = await services.connections.create(source.manifest.id, sharedDraft(source.manifest, kids.id));
      const [shared] = await services.connections.list(source.manifest.id);
      expect([...(shared?.setUp ?? [])].toSorted()).toEqual([alex.id, kids.id].toSorted());

      const edit = await services.connections.edit(created.id);
      if (!edit) throw new Error('setup');
      let draft = switchMode(source.manifest, sharedDraft(source.manifest, kids.id), 'credentials', kids.id, edit.saved);
      await services.connections.update(created.id, draft);
      const [split] = await services.connections.list(source.manifest.id);
      expect([...(split?.setUp ?? [])]).toEqual([kids.id]);

      draft = setProfileOff(draft, kids.id, true);
      await services.connections.update(created.id, draft);
      const [off] = await services.connections.list(source.manifest.id);
      expect(off?.setUp.size).toBe(0);
      expect([...(off?.off ?? [])]).toEqual([kids.id]);
    });

    it('removes every secret and session with the connection', async () => {
      const { services, credentials, source, kids } = await setUp();
      const created = await services.connections.create(source.manifest.id, sharedDraft(source.manifest, kids.id));
      const ref = created.values.credentialsRef;
      await services.connections.remove(created.id);
      expect(ref && (await credentials.read(ref))).toBeUndefined();
      expect(await services.connections.list(source.manifest.id)).toEqual([]);
    });

    it('hands a probe the saved secret, with the edit applied', async () => {
      const { services, source, kids } = await setUp();
      const created = await services.connections.create(source.manifest.id, sharedDraft(source.manifest, kids.id));
      await expect(services.connections.probeSecrets(source.manifest.id, created.id, 'shared', {})).resolves.toEqual({
        password: 'family-secret',
      });
      await expect(
        services.connections.probeSecrets(source.manifest.id, created.id, 'shared', { password: 'typed' }),
      ).resolves.toEqual({ password: 'typed' });
    });

    it('reports saved secrets by name only', async () => {
      const { services, source, kids } = await setUp();
      const created = await services.connections.create(source.manifest.id, sharedDraft(source.manifest, kids.id));
      const edit = await services.connections.edit(created.id);
      expect(edit && savedSecretsOf(edit.connection, edit.profileValues).shared).toEqual(new Set(['password']));
    });
  });

  describe('sources and profiles', () => {
    it('resolves each profile’s own values and leaves the rest pending', async () => {
      const { services, source, kids, alex } = await setUp();
      const created = await services.connections.create(source.manifest.id, sharedDraft(source.manifest, kids.id));
      const edit = await services.connections.edit(created.id);
      if (!edit) throw new Error('setup');
      await services.connections.update(created.id, switchMode(source.manifest, sharedDraft(source.manifest, kids.id), 'credentials', kids.id, edit.saved));

      const [forKids] = await services.sources.forUser(kids.id);
      expect(forKids?.scope).toBe(kids.id);
      expect(forKids?.values.fields).toEqual({ serverUrl: 'http://home:8096', username: 'family' });
      expect(await services.sources.forUser(alex.id)).toEqual([]);
      expect((await services.sources.pendingFor(alex.id)).map((pending) => pending.connection.id)).toEqual([created.id]);
    });

    it('neither shows nor asks about a connection a profile switched off', async () => {
      const { services, db, credentials, source, kids, alex } = await setUp();
      const created = await services.connections.create(source.manifest.id, sharedDraft(source.manifest, kids.id));
      const edit = await services.connections.edit(created.id);
      if (!edit) throw new Error('setup');
      const split = switchMode(source.manifest, sharedDraft(source.manifest, kids.id), 'credentials', kids.id, edit.saved);
      await services.connections.update(created.id, split);
      const ref = (await db.connections.profileValues(created.id)).get(kids.id)?.credentialsRef;
      expect(ref).toBeDefined();

      await services.connections.update(created.id, setProfileOff(setProfileOff(split, alex.id, true), kids.id, true));
      for (const profile of [kids, alex]) {
        expect(await services.sources.forUser(profile.id)).toEqual([]);
        expect(await services.sources.pendingFor(profile.id)).toEqual([]);
      }
      // The row says off and holds nothing else; the password went with the rest.
      expect((await db.connections.profileValues(created.id)).get(kids.id)).toEqual({ fields: {}, settings: {}, off: true });
      expect(ref && (await credentials.read(ref))).toBeUndefined();

      // Back on, the profile has to finish setting it up again.
      const stored = await services.connections.edit(created.id);
      if (!stored) throw new Error('setup');
      await services.connections.update(created.id, setProfileOff(draftOf(source.manifest, stored), kids.id, false));
      expect((await services.sources.pendingFor(kids.id)).map((pending) => pending.connection.id)).toEqual([created.id]);
      expect(await services.sources.pendingFor(alex.id)).toEqual([]);
    });

    it('hides every connection of a plugin that is not installed', async () => {
      const { services, source, kids } = await setUp();
      await services.connections.create(source.manifest.id, sharedDraft(source.manifest, kids.id));
      await services.devicePlugins.setEnabled(source.manifest.id, false);
      expect(await services.sources.forUser(kids.id)).toEqual([]);
    });

    it('deletes a profile’s own values and secrets with it', async () => {
      const { services, db, credentials, source, kids, alex } = await setUp();
      const created = await services.connections.create(source.manifest.id, sharedDraft(source.manifest, alex.id));
      const edit = await services.connections.edit(created.id);
      if (!edit) throw new Error('setup');
      await services.connections.update(created.id, switchMode(source.manifest, sharedDraft(source.manifest, alex.id), 'credentials', alex.id, edit.saved));
      const ref = (await db.connections.profileValues(created.id)).get(alex.id)?.credentialsRef;
      expect(ref).toBeDefined();

      await services.profiles.remove(alex.id);
      expect((await db.connections.profileValues(created.id)).has(alex.id)).toBe(false);
      expect(ref && (await credentials.read(ref))).toBeUndefined();
      expect(await db.connections.get(created.id)).toBeDefined();
      expect(await services.profiles.get(kids.id)).toBeDefined();
    });
  });
});
