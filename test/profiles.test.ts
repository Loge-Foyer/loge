import { describe, expect, it } from 'vitest';

import { initialDraft, setSecret, setValue } from '@/services/connection-draft';
import { moveRow } from '@/services/home-layout';

import { ENGINES, reopenable, type Engine } from './support/engines';
import { memoryCredentialStore } from './support/fakes';
import { buildServices, fakeMediaPlugin } from './support/services';

describe.each(ENGINES)('profiles on %s', (engine: Engine) => {
  const source = fakeMediaPlugin('fake');

  it('make the first profile the device’s default, and only the first', async () => {
    const { services } = buildServices({ plugins: [source.plugin], engine });
    const kids = await services.profiles.create('Kids');
    await services.profiles.create('Alex');
    expect(await services.profiles.defaultUserId()).toBe(kids.id);
    expect((await services.profiles.list()).map((profile) => profile.name)).toEqual(['Kids', 'Alex']);
  });

  it('clear the default when the default profile goes, and refuse to delete the last one', async () => {
    const { services, db } = buildServices({ plugins: [source.plugin], engine });
    const kids = await services.profiles.create('Kids');
    const alex = await services.profiles.create('Alex');
    await services.profiles.remove(kids.id);
    expect(await services.profiles.defaultUserId()).toBeUndefined();
    await expect(services.profiles.remove(alex.id)).rejects.toThrow('last profile');
    expect((await db.users.list()).map((user) => user.id)).toEqual([alex.id]);
  });

  it('ask who is watching at every launch on a TV, until it is told to open the default', async () => {
    const where = reopenable(engine);
    const credentials = memoryCredentialStore();
    const deviceBound = memoryCredentialStore();
    const launch = async () => {
      const services = buildServices({ plugins: [source.plugin], engine, where, credentials, deviceBound, tv: true }).services;
      await services.account.ensureAccount();
      await services.session.start();
      return services;
    };
    const kids = await (await launch()).profiles.create('Kids');

    // The first profile made is still the default; a TV asks anyway.
    const tv = await launch();
    expect(tv.session.getSnapshot()).toEqual({ kind: 'needs-user-selection' });
    // A sync arriving while the picker is up does not walk past it.
    await tv.session.refresh();
    expect(tv.session.getSnapshot()).toEqual({ kind: 'needs-user-selection' });

    await tv.appSettings.set({ alwaysChooseProfile: false });
    expect((await launch()).session.getSnapshot()).toEqual({ kind: 'ready', userId: kids.id });
  });

  it('come back after a restart: profiles, PINs, the default, connections and layouts', async () => {
    const where = reopenable(engine);
    const credentials = memoryCredentialStore();
    const deviceBound = memoryCredentialStore();
    const first = buildServices({ plugins: [source.plugin], engine, where, credentials, deviceBound }).services;
    const kids = await first.profiles.create('Kids');
    const alex = await first.profiles.create('Alex');
    await first.pins.create(alex.id, '1234');
    await first.profiles.setDefault(alex.id);
    let draft = initialDraft(source.manifest, 0);
    draft = setValue(source.manifest, draft, kids.id, 'fields', 'serverUrl', 'http://home:8096');
    draft = setValue(source.manifest, draft, kids.id, 'fields', 'username', 'family');
    draft = setSecret(draft, kids.id, 'password', 'family-secret');
    const created = await first.connections.create(source.manifest.id, draft);
    const moved = await first.homeLayout.update(kids.id, (rows) => moveRow(rows, 'shows', -1));

    // A new launch: a new graph on the same database and the same keychain.
    const again = buildServices({ plugins: [source.plugin], engine, where, credentials, deviceBound }).services;
    // As the app starts: a device with profiles and no account keeps them as one of its own.
    await again.account.ensureAccount();
    await again.session.start();
    expect(again.session.getSnapshot()).toEqual({ kind: 'needs-user-unlock', userId: alex.id });
    expect(await again.session.unlock(alex.id, '1234')).toEqual({ ok: true });
    expect((await again.profiles.list()).map((profile) => profile.name)).toEqual(['Kids', 'Alex']);
    expect((await again.connections.list(source.manifest.id)).map((summary) => summary.connection)).toEqual([created]);
    expect((await again.sources.forUser(kids.id)).map((live) => live.connection.id)).toEqual([created.id]);
    expect(await again.homeLayout.rows(kids.id)).toEqual(moved);
    await expect(again.connections.probeSecrets(source.manifest.id, created.id, 'shared', {})).resolves.toEqual({
      password: 'family-secret',
    });
  });
});
