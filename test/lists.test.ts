import { connectionId, imageRef, type Channel, type GlobalMediaKey, type MediaItem } from '@sc/api';
import { describe, expect, it } from 'vitest';

import { initialDraft, setSecret, setValue } from '@/services/connection-draft';
import { asChannel } from '@/services/lists';

import { buildServices, fakeMediaPlugin } from './support/services';

let home = connectionId('c-home');
const key = (id: string): GlobalMediaKey => ({ connectionId: home, externalId: id });
const channel = (id: string, title: string): MediaItem => ({
  type: 'show',
  key: key(id),
  title,
  ratings: {},
  genres: [],
  images: {},
});

async function setUp() {
  const source = fakeMediaPlugin('home');
  const built = buildServices({ plugins: [source.plugin] });
  const sam = (await built.services.profiles.create('Sam')).id;
  // A subscription cascades from its connection as well as its profile, so
  // there has to be one for it to point at.
  let draft = initialDraft(source.manifest, 0);
  draft = setValue(source.manifest, draft, sam, 'fields', 'serverUrl', 'http://home:8096');
  draft = setValue(source.manifest, draft, sam, 'fields', 'username', 'family');
  draft = setSecret(draft, sam, 'password', 'secret');
  home = (await built.services.connections.create(source.manifest.id, draft)).id;
  return { ...built, sam };
}

describe('channels a profile follows', () => {
  it('follows once, however often it is asked', async () => {
    const { services, sam } = await setUp();
    const first = await services.lists.follow(sam, channel('UC1', 'Some Channel'));
    const again = await services.lists.follow(sam, channel('UC1', 'Some Channel, renamed'));
    expect(again.id).toBe(first.id);
    // The title is what it was when followed: renaming on the source does not
    // rewrite what someone chose to keep.
    expect(again.title).toBe('Some Channel');
    expect(await services.lists.subscriptions(sam)).toHaveLength(1);
  });

  it('says whether it already follows one, which is what the button reads', async () => {
    const { services, sam } = await setUp();
    expect(await services.lists.follows(sam, home, 'UC1')).toBeUndefined();
    await services.lists.follow(sam, channel('UC1', 'Some Channel'));
    expect(await services.lists.follows(sam, home, 'UC1')).toMatchObject({ title: 'Some Channel' });
  });

  it('keeps each profile’s own', async () => {
    const { services, sam } = await setUp();
    const robin = (await services.profiles.create('Robin')).id;
    await services.lists.follow(sam, channel('UC1', 'Some Channel'));
    expect(await services.lists.subscriptions(robin)).toEqual([]);
  });
});

describe('lists a profile makes', () => {
  it('refuses a list with no name', async () => {
    const { services, sam } = await setUp();
    await expect(services.lists.create(sam, '   ')).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('holds each item once, in the order they were added', async () => {
    const { services, sam } = await setUp();
    const list = await services.lists.create(sam, 'Rewatch');
    await services.lists.add(list.id, key('m1'));
    await services.lists.add(list.id, key('m2'));
    await services.lists.add(list.id, key('m1'));
    expect((await services.lists.playlist(list.id))?.items.map((item) => item.externalId)).toEqual(['m1', 'm2']);
  });

  it('may mix sources: a film from one connection beside a video from another', async () => {
    const { services, sam } = await setUp();
    const list = await services.lists.create(sam, 'Mixed');
    await services.lists.add(list.id, key('m1'));
    await services.lists.add(list.id, { connectionId: connectionId('c-videos'), externalId: 'dQw4w9WgXcQ' });
    expect((await services.lists.playlist(list.id))?.items).toHaveLength(2);
  });

  it('takes a whole new order at once, which is how a list is edited', async () => {
    const { services, sam } = await setUp();
    const list = await services.lists.create(sam, 'Rewatch');
    await services.lists.add(list.id, key('m1'));
    await services.lists.add(list.id, key('m2'));
    await services.lists.reorder(list.id, [key('m2'), key('m1')]);
    expect((await services.lists.playlist(list.id))?.items.map((item) => item.externalId)).toEqual(['m2', 'm1']);
  });

  it('writes nothing, and journals nothing, when nothing changed', async () => {
    const { services, db, sam } = await setUp();
    const list = await services.lists.create(sam, 'Rewatch');
    await services.lists.add(list.id, key('m1'));
    const head = await db.journal.head();
    await services.lists.add(list.id, key('m1'));
    await services.lists.rename(list.id, 'Rewatch');
    expect(await db.journal.head()).toBe(head);
    expect((await db.playlists.get(list.id))?.version).toBe(2);
  });

  it('counts a version up on every real change, so the server sees the newer one', async () => {
    const { services, db, sam } = await setUp();
    const list = await services.lists.create(sam, 'Rewatch');
    await services.lists.rename(list.id, 'Rewatch, renamed');
    await services.lists.add(list.id, key('m1'));
    expect((await db.playlists.get(list.id))?.version).toBe(3);
  });

  it('refuses to rename a list that is gone, rather than making one', async () => {
    const { services, sam } = await setUp();
    void sam;
    await expect(services.lists.rename('nobody', 'A name')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('channels a profile keeps at hand', () => {
  const live = (id: string, name: string, extra: Partial<Channel> = {}): Channel => ({ key: key(id), name, groupIds: ['news'], ...extra });

  it('keeps a channel once, as it was when chosen, however often it is asked', async () => {
    const { services, sam } = await setUp();
    const first = await services.lists.favorite(sam, live('ch:1', 'Das Erste', { number: 1, logo: imageRef('http://portal.test/1.png') }));
    const again = await services.lists.favorite(sam, live('ch:1', 'Das Erste HD', { number: 9 }));
    expect(again.id).toBe(first.id);
    expect(await services.lists.favoriteOf(sam, home, 'ch:1')).toMatchObject({ name: 'Das Erste', number: 1, logo: 'http://portal.test/1.png' });
    // As a channel again: enough to draw its row and play it.
    expect(asChannel(first)).toEqual({ key: key('ch:1'), name: 'Das Erste', number: 1, logo: 'http://portal.test/1.png', groupIds: [] });
  });

  it('lists a connection’s in its own numbering, the unnumbered by name after them', async () => {
    const { services, sam } = await setUp();
    await services.lists.favorite(sam, live('ch:z', 'Zulu'));
    await services.lists.favorite(sam, live('ch:7', 'Seven', { number: 7 }));
    await services.lists.favorite(sam, live('ch:a', 'Alpha'));
    await services.lists.favorite(sam, live('ch:2', 'Two', { number: 2 }));
    expect((await services.lists.favoriteChannels(sam, home)).map((favorite) => favorite.name)).toEqual(['Two', 'Seven', 'Alpha', 'Zulu']);
    expect(await services.lists.favoriteChannels(sam, connectionId('c-elsewhere'))).toEqual([]);
  });

  it('lets one go', async () => {
    const { services, sam } = await setUp();
    const kept = await services.lists.favorite(sam, live('ch:1', 'Das Erste'));
    await services.lists.unfavorite(sam, kept.id);
    expect(await services.lists.favoriteOf(sam, home, 'ch:1')).toBeUndefined();
  });

  it('keeps only what the account can carry: a name it can hold, a number from 1, a logo no longer than an address', async () => {
    const { services, sam } = await setUp();
    const kept = await services.lists.favorite(sam, live('ch:0', `  ${'Long '.repeat(60)}`, { number: 0, logo: imageRef(`http://portal.test/${'x'.repeat(2100)}`) }));
    expect(kept.name.length).toBeLessThanOrEqual(200);
    expect(kept.name.startsWith('Long')).toBe(true);
    expect(kept.number).toBeUndefined();
    expect(kept.logo).toBeUndefined();
  });
});
