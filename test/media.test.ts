import { AppError, imageRef, type ConnectionId, type MediaItem, type Plugin, type UserId } from '@loge/api';
import { describe, expect, it, vi } from 'vitest';

import { initialDraft, setSecret, setValue } from '@/services/connection-draft';
import type { MergeState } from '@/services/media';

import { buildServices, fakeMediaPlugin, fakeNetwork, movie } from './support/services';

const NEWEST = { by: 'releaseDate', order: 'desc' } as const;

async function withSources(sources: readonly ReturnType<typeof fakeMediaPlugin>[], network = fakeNetwork()) {
  const built = buildServices({ plugins: sources.map((source) => source.plugin), network });
  const { services } = built;
  const kids = await services.profiles.create('Kids');
  const ids: ConnectionId[] = [];
  for (const source of sources) {
    let draft = initialDraft(source.manifest, 0);
    draft = setValue(source.manifest, draft, kids.id, 'fields', 'serverUrl', `http://${source.manifest.id}`);
    draft = setValue(source.manifest, draft, kids.id, 'fields', 'username', 'kid');
    draft = setSecret(draft, kids.id, 'password', 'secret');
    ids.push((await services.connections.create(source.manifest.id, draft)).id);
  }
  return { ...built, services, kids: kids.id, ids };
}

const years = (items: readonly MediaItem[]) => items.map((item) => item.year);

describe('media rows', () => {
  it('merges every source into one row in the row’s order', async () => {
    const a = fakeMediaPlugin('alpha', { movies: (id) => [2024, 2016, 2008].map((year) => movie(id, `a${year}`, year)) });
    const b = fakeMediaPlugin('beta', { movies: (id) => [2020, 2012].map((year) => movie(id, `b${year}`, year)) });
    const { services, kids } = await withSources([a, b]);
    const row = await services.media.row(kids, { kind: 'movies', sort: NEWEST }, 4);
    expect(years(row.items)).toEqual([2024, 2020, 2016, 2012]);
    expect(row.sourceErrors).toEqual([]);
  });

  it('shows what arrived when one source fails, and says which one', async () => {
    const good = fakeMediaPlugin('good', { movies: (id) => [movie(id, 'x', 2020)] });
    const bad = fakeMediaPlugin('bad', { failWith: () => new AppError('PROVIDER_UNAVAILABLE', 'Starting up', { retry: 'backoff' }) });
    const { services, kids } = await withSources([good, bad]);
    const row = await services.media.row(kids, { kind: 'movies', sort: NEWEST }, 10);
    expect(row.items).toHaveLength(1);
    expect(row.sourceErrors).toEqual([
      expect.objectContaining({ label: 'bad', code: 'PROVIDER_UNAVAILABLE', retry: 'backoff' }),
    ]);
  });

  it('parks a source that can only answer on another network, until the network changes', async () => {
    let away = true;
    const home = fakeMediaPlugin('home', {
      movies: (id) => [movie(id, 'x', 2020)],
      failWith: () =>
        away ? new AppError('OFFLINE', 'Home network only', { retry: 'network-change', reason: 'local-network-only' }) : undefined,
    });
    const network = fakeNetwork('cellular');
    const { services, kids } = await withSources([home], network);
    const spec = { kind: 'movies', sort: NEWEST } as const;

    expect((await services.media.row(kids, spec, 10)).sourceErrors[0]?.reason).toBe('local-network-only');
    const callsWhenParked = home.stats.calls;
    await services.media.row(kids, spec, 10);
    expect(home.stats.calls).toBe(callsWhenParked);

    away = false;
    let told = 0;
    services.media.subscribe(() => {
      told += 1;
    });
    network.set('wifi');
    expect(told).toBe(1);
    expect((await services.media.row(kids, spec, 10)).items).toHaveLength(1);
  });

  it('asks again after a manual refresh', async () => {
    let refuse = true;
    const source = fakeMediaPlugin('source', {
      movies: (id) => [movie(id, 'x', 2020)],
      failWith: () => (refuse ? new AppError('UNAUTHORIZED', 'No', { retry: 'never' }) : undefined),
    });
    const { services, kids } = await withSources([source]);
    const spec = { kind: 'movies', sort: NEWEST } as const;
    await services.media.row(kids, spec, 10);
    refuse = false;
    expect((await services.media.row(kids, spec, 10)).sourceErrors).toHaveLength(1);
    services.media.unpark();
    expect((await services.media.row(kids, spec, 10)).sourceErrors).toHaveLength(0);
  });

  it('continues watching across sources, most recent first, at most ten', async () => {
    const at = (day: number) => ({ played: false, positionMs: 60_000, progress: 0.5, lastPlayedAt: `2026-09-${String(day).padStart(2, '0')}T20:00:00.000Z` });
    const a = fakeMediaPlugin('alpha', { resume: (id) => [1, 3, 5, 7, 9, 11].map((day) => movie(id, `a${day}`, 2000, { watch: at(day) })) });
    const b = fakeMediaPlugin('beta', { resume: (id) => [2, 4, 6, 8, 10, 12].map((day) => movie(id, `b${day}`, 2000, { watch: at(day) })) });
    const { services, kids } = await withSources([a, b]);
    const { items } = await services.media.continueWatching(kids);
    expect(items.map((item) => item.key.externalId)).toEqual(['b12', 'a11', 'b10', 'a9', 'b8', 'a7', 'b6', 'a5', 'b4', 'a3']);
  });
});

describe('media grid', () => {
  it('pages across sources with no duplicates or gaps, and ends', async () => {
    const a = fakeMediaPlugin('alpha', { movies: (id) => [2025, 2019, 2013, 2007, 2001].map((year) => movie(id, `a${year}`, year)) });
    const b = fakeMediaPlugin('beta', { movies: (id) => [2022, 2021, 2004].map((year) => movie(id, `b${year}`, year)) });
    const { services, kids } = await withSources([a, b]);
    const spec = { kind: 'movies', sort: NEWEST } as const;
    const seen: number[] = [];
    let state: MergeState | null = null;
    let pages = 0;
    do {
      const page = await services.media.gridPage(kids, spec, state, 3);
      seen.push(...years(page.items).flatMap((year) => (year === undefined ? [] : [year])));
      if (pages === 0) expect(page.total).toBe(8);
      state = page.next ?? null;
      pages += 1;
    } while (state && pages < 10);
    expect(seen).toEqual([2025, 2022, 2021, 2019, 2013, 2007, 2004, 2001]);
    expect(pages).toBeLessThan(10);
  });

  it('searches only the sources that promised to, and keeps the search inside its kind', async () => {
    const titled = (id: string) => (connectionId: ConnectionId) =>
      [movie(connectionId, `${id}-erste`, 2025), movie(connectionId, `${id}-zweite`, 2024)].map((item) => ({ ...item, title: item.key.externalId }));
    const searching = fakeMediaPlugin('alpha', { movies: titled('a'), searches: true });
    const browsing = fakeMediaPlugin('beta', { movies: titled('b') });
    const { services, kids } = await withSources([searching, browsing]);

    const page = await services.media.gridPage(kids, { kind: 'movies', sort: NEWEST, term: 'erste' }, null, 10);
    // Only the source that declared `search` is asked — the other is left out
    // rather than answered for, so nothing unmatched slips into the results.
    expect(page.items.map((item) => item.key.externalId)).toEqual(['a-erste']);
    expect(searching.stats.terms).toEqual(['erste']);
    expect(browsing.stats.terms).toEqual([]);

    // Browsing is unchanged, and asks for no term at all.
    const all = await services.media.gridPage(kids, { kind: 'movies', sort: NEWEST }, null, 10);
    expect(all.items.length).toBe(4);
    expect(browsing.stats.terms).toEqual([undefined]);
  });

  it('keeps showing one source when the other fails midway', async () => {
    let fail = false;
    const a = fakeMediaPlugin('alpha', { movies: (id) => [2020, 2018, 2016, 2014].map((year) => movie(id, `a${year}`, year)) });
    const b = fakeMediaPlugin('beta', {
      movies: (id) => [2019, 2017, 2015].map((year) => movie(id, `b${year}`, year)),
      failWith: () => (fail ? new AppError('PROVIDER_UNAVAILABLE', 'Gone', { retry: 'backoff' }) : undefined),
    });
    const { services, kids } = await withSources([a, b]);
    const spec = { kind: 'movies', sort: NEWEST } as const;
    const first = await services.media.gridPage(kids, spec, null, 2);
    expect(years(first.items)).toEqual([2020, 2019]);
    fail = true;
    const rest: MediaItem[] = [];
    let state = first.next ?? null;
    let errors = 0;
    while (state) {
      const page = await services.media.gridPage(kids, spec, state, 2);
      rest.push(...page.items);
      errors += page.sourceErrors.length;
      state = page.next ?? null;
    }
    // Beta's buffered 2017 still shows; after that only alpha answers.
    expect(years(rest)).toEqual([2018, 2017, 2016, 2014]);
    expect(errors).toBe(1);
  });
});

describe('media pool', () => {
  it('connects once for every row of a shared connection, and again when its values change', async () => {
    const source = fakeMediaPlugin('source', { movies: (id) => [movie(id, 'x', 2020)] });
    const { services, kids, ids } = await withSources([source]);
    const alex = await services.profiles.create('Alex');
    const spec = { kind: 'movies', sort: NEWEST } as const;
    await Promise.all([services.media.row(kids, spec, 10), services.media.row(alex.id, spec, 10), services.media.continueWatching(kids)]);
    expect(source.stats.connects).toBe(1);

    const connectionId = ids[0];
    if (!connectionId) throw new Error('setup');
    const edit = await services.connections.edit(connectionId);
    if (!edit) throw new Error('setup');
    let draft = initialDraft(source.manifest, 0);
    draft = setValue(source.manifest, draft, kids, 'fields', 'serverUrl', 'http://moved');
    draft = setValue(source.manifest, draft, kids, 'fields', 'username', 'kid');
    await services.connections.update(connectionId, draft);
    await services.media.row(kids, spec, 10);
    expect(source.stats.connects).toBe(2);
    expect(source.stats.disposed).toBe(1);
  });

  it('resolves artwork only for a connected source that has it', async () => {
    const withArt = fakeMediaPlugin('art', { movies: (id) => [movie(id, 'x', 2020)], withImages: true });
    const without = fakeMediaPlugin('plain', { movies: (id) => [movie(id, 'y', 2019)] });
    const { services, kids, ids } = await withSources([withArt, without]);
    const [artId, plainId] = ids as [ConnectionId, ConnectionId];
    expect(services.media.artwork(kids as UserId, artId, imageRef('poster'), { width: 300 })).toBeNull();
    await services.media.row(kids, { kind: 'movies', sort: NEWEST }, 10);
    expect(services.media.artwork(kids, artId, imageRef('poster'), { width: 300 })).toEqual({
      uri: 'https://img.test/poster?w=300',
      cachePolicy: 'memory-disk',
    });
    expect(services.media.artwork(kids, plainId, imageRef('poster'), { width: 300 })).toBeNull();
  });

  it('resolves again once its source is ready, and moves on only when something changed', async () => {
    const withArt = fakeMediaPlugin('art', { movies: (id) => [movie(id, 'x', 2020)], withImages: true });
    const { services, kids, ids } = await withSources([withArt]);
    const [artId] = ids as [ConnectionId];
    const poster = imageRef('poster');
    let told = 0;
    const stop = services.media.subscribeArtwork(() => {
      told += 1;
    });

    // A card drawn from what was saved, before anything asked the source.
    expect(services.media.artwork(kids, artId, poster, { width: 300 })).toBeNull();
    const before = services.media.artworkGeneration(artId);
    services.media.prepareArtwork(kids, artId);
    await vi.waitFor(() => expect(services.media.artworkGeneration(artId)).toBeGreaterThan(before));
    expect(told).toBeGreaterThan(0);
    // No sign-in for an address: connecting does no network work.
    expect(withArt.stats.calls).toBe(0);
    const resolved = services.media.artwork(kids, artId, poster, { width: 300 });
    expect(resolved).toEqual({ uri: 'https://img.test/poster?w=300', cachePolicy: 'memory-disk' });
    // The same object for the same address: the web image component fetches again for a new one.
    expect(services.media.artwork(kids, artId, poster, { width: 300 })).toBe(resolved);

    // Ready already, so preparing again moves nothing — or a card that cannot resolve would ask for ever.
    const settled = services.media.artworkGeneration(artId);
    services.media.prepareArtwork(kids, artId);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(services.media.artworkGeneration(artId)).toBe(settled);

    // An answer moves it on, and so does letting the connection go.
    await services.media.row(kids, { kind: 'movies', sort: NEWEST }, 10);
    expect(services.media.artworkGeneration(artId)).toBeGreaterThan(settled);
    const answered = services.media.artworkGeneration(artId);
    services.media.forgetConnection(artId);
    expect(services.media.artworkGeneration(artId)).toBeGreaterThan(answered);
    expect(services.media.artwork(kids, artId, poster, { width: 300 })).toBeNull();
    stop();
  });

  it('tests a draft with the secret being typed, outside the pool', async () => {
    const source = fakeMediaPlugin('source');
    const { services } = await withSources([]);
    const built = buildServices({ plugins: [source.plugin as Plugin] });
    await built.services.profiles.create('Kids');
    await expect(
      built.services.media.test({
        pluginId: source.manifest.id,
        fields: { serverUrl: 'http://draft', username: 'kid' },
        settings: {},
        scope: 'shared',
        secrets: { password: 'typed' },
      }),
    ).resolves.toEqual({ serverName: 'http://draft', version: 'test' });
    expect(source.stats.credentials).toEqual([{ password: 'typed' }]);
    expect(source.stats.disposed).toBe(1);
    expect(services).toBeDefined();
  });
});
