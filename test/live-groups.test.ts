import type { ConnectionId } from '@loge/api';
import { describe, expect, it } from 'vitest';

import { initialDraft, setSecret, setValue } from '@/services/connection-draft';
import { openingGroup } from '@/services/live-groups';

import { ENGINES, type Engine } from './support/engines';
import { buildServices, fakeMediaPlugin } from './support/services';

describe('where Live opens', () => {
  const groups = [{ id: 'news' }, { id: 'sport' }];

  it('opens on the favourites while the profile keeps any there, whatever was chosen last', () => {
    expect(openingGroup({ favorites: 2, last: 'sport', groups })).toEqual({ kind: 'favorites' });
    expect(openingGroup({ favorites: 1, last: undefined, groups: undefined })).toEqual({ kind: 'favorites' });
  });

  it('opens on the group chosen last while the provider still has it', () => {
    expect(openingGroup({ favorites: 0, last: 'sport', groups })).toEqual({ kind: 'group', id: 'sport' });
  });

  it('opens on All when nothing was chosen, All was, or the group is gone', () => {
    expect(openingGroup({ favorites: 0, last: null, groups: undefined })).toEqual({ kind: 'all' });
    expect(openingGroup({ favorites: 0, last: '', groups: undefined })).toEqual({ kind: 'all' });
    expect(openingGroup({ favorites: 0, last: 'cinema', groups })).toEqual({ kind: 'all' });
  });

  it('waits while what decides it is still being read, so nothing is asked of the provider for nothing', () => {
    expect(openingGroup({ favorites: undefined, last: 'sport', groups })).toBeUndefined();
    expect(openingGroup({ favorites: 0, last: undefined, groups })).toBeUndefined();
    expect(openingGroup({ favorites: 0, last: 'sport', groups: undefined })).toBeUndefined();
  });
});

describe.each(ENGINES)('the Live group chosen last, on %s', (engine: Engine) => {
  async function setUp() {
    const source = fakeMediaPlugin('portal');
    const built = buildServices({ plugins: [source.plugin], engine });
    const { services } = built;
    const sam = (await services.profiles.create('Sam')).id;
    const robin = (await services.profiles.create('Robin')).id;
    const connect = async (url: string): Promise<ConnectionId> => {
      let draft = initialDraft(source.manifest, 0);
      draft = setValue(source.manifest, draft, sam, 'fields', 'serverUrl', url);
      draft = setValue(source.manifest, draft, sam, 'fields', 'username', 'family');
      draft = setSecret(draft, sam, 'password', 'secret');
      return (await services.connections.create(source.manifest.id, draft)).id;
    };
    const home = await connect('http://home:8096');
    const away = await connect('http://away:8096');
    return { ...built, sam, robin, home, away };
  }

  it('keeps one for each profile and each provider', async () => {
    const { services, sam, robin, home, away } = await setUp();
    await services.liveGroups.remember(sam, home, 'news');
    await services.liveGroups.remember(sam, away, '');
    await services.liveGroups.remember(robin, home, 'sport');
    expect(await services.liveGroups.last(sam, home)).toBe('news');
    expect(await services.liveGroups.last(sam, away)).toBe('');
    expect(await services.liveGroups.last(robin, home)).toBe('sport');
    expect(await services.liveGroups.last(robin, away)).toBeNull();
  });

  it('is this device’s alone: nothing of it is journaled', async () => {
    const { services, db, sam, home } = await setUp();
    const before = await db.journal.entries();
    await services.liveGroups.remember(sam, home, 'news');
    await services.liveGroups.remember(sam, home, 'sport');
    expect(await db.journal.entries()).toEqual(before);
  });

  it('writes nothing for a profile that is gone', async () => {
    const { services, db, robin, home } = await setUp();
    await services.profiles.remove(robin);
    await services.liveGroups.remember(robin, home, 'sport');
    expect((await db.deviceSettings.get()).liveGroups).toBeUndefined();
  });

  it('goes with its profile', async () => {
    const { services, db, sam, robin, home } = await setUp();
    await services.liveGroups.remember(sam, home, 'news');
    await services.liveGroups.remember(robin, home, 'sport');
    await services.profiles.remove(robin);
    expect((await db.deviceSettings.get()).liveGroups).toEqual({ [sam]: { [home]: 'news' } });
  });

  it('goes with its provider, under every profile, and leaves nothing behind', async () => {
    const { services, db, sam, robin, home, away } = await setUp();
    await services.liveGroups.remember(sam, home, 'news');
    await services.liveGroups.remember(sam, away, 'sport');
    await services.liveGroups.remember(robin, home, 'sport');
    await services.connections.remove(home);
    expect((await db.deviceSettings.get()).liveGroups).toEqual({ [sam]: { [away]: 'sport' } });
    await services.connections.remove(away);
    expect((await db.deviceSettings.get()).liveGroups).toBeUndefined();
  });
});
