import { connectionId, identityHash, userId, type ConnectionId, type Episode, type MediaItem, type Movie, type Show } from '@loge/api';
import { describe, expect, it } from 'vitest';

import { initialDraft, setSecret, setValue } from '@/services/connection-draft';
import type { WatchProgress } from '@/services/ports';
import { mergeWatchProgress } from '@/services/sync/reconcile';

import { ENGINES, type Engine } from './support/engines';
import { buildServices, fakeMediaPlugin, movie } from './support/services';

const MINUTE = 60_000;

function film(connection: ConnectionId, id: string, extra: Partial<Movie> = {}): Movie {
  return movie(connection, id, 1999, { runtimeMs: 100 * MINUTE, ...extra });
}

function show(connection: ConnectionId, id: string, tmdb: string): Show {
  return { type: 'show', key: { connectionId: connection, externalId: id }, title: `Show ${id}`, externalIds: { tmdb }, ratings: {}, genres: [], images: {} };
}

function episode(connection: ConnectionId, of: Show, season: number, number: number): Episode {
  return {
    type: 'episode',
    key: { connectionId: connection, externalId: `${of.key.externalId}:${season}:${number}` },
    title: `Episode ${number}`,
    show: of.key,
    showTitle: of.title,
    ...(of.externalIds ? { showExternalIds: of.externalIds } : {}),
    seasonNumber: season,
    episodeNumber: number,
    ratings: {},
    genres: [],
    images: { poster: 'cover' as never },
  };
}

describe.each(ENGINES)('watch status the app keeps, on %s', (engine: Engine) => {
  /** A portal that keeps no watch status, and a media server that keeps its own, on one profile. */
  async function setUp() {
    const portal = fakeMediaPlugin('portal', { category: 'iptv', kinds: ['live', 'movies', 'shows'], keepsNoWatchState: true });
    const server = fakeMediaPlugin('server', {});
    const files = fakeMediaPlugin('files', { keepsNoWatchState: true });
    const built = buildServices({ plugins: [portal.plugin, server.plugin, files.plugin], engine });
    const kids = (await built.services.profiles.create('Kids')).id;
    const connect = async (media: typeof portal) => {
      let draft = initialDraft(media.manifest, 0);
      draft = setValue(media.manifest, draft, kids, 'fields', 'serverUrl', 'http://home:8096');
      draft = setValue(media.manifest, draft, kids, 'fields', 'username', 'family');
      draft = setSecret(draft, kids, 'password', 'secret');
      return (await built.services.connections.create(media.manifest.id, draft)).id;
    };
    return { ...built, kids, tv: await connect(portal), home: await connect(server), library: await connect(files) };
  }

  const keeperOf = async (t: Awaited<ReturnType<typeof setUp>>, id: ConnectionId) =>
    (await t.services.sources.forUser(t.kids)).find((source) => source.connection.id === id)?.watch;

  it('keeps it for a provider that keeps none, and leaves a media server its own', async () => {
    const t = await setUp();
    expect(await keeperOf(t, t.tv)).toBe('app');
    expect(await keeperOf(t, t.home)).toBe('source');
    // Media is off until someone says otherwise: a source there keeping none has nobody keep it.
    expect(await keeperOf(t, t.library)).toBeUndefined();
    await t.services.accountSettings.setWatchStatus({ media: true });
    expect(await keeperOf(t, t.library)).toBe('app');
    await t.services.accountSettings.setWatchStatus({ tv: false });
    expect(await keeperOf(t, t.tv)).toBeUndefined();
    // And the media server keeps its own whatever the account says.
    expect(await keeperOf(t, t.home)).toBe('source');
  });

  it('writes where it got to here, journaled for the account, with nothing queued for any source', async () => {
    const t = await setUp();
    const head = await t.db.journal.head();
    const item = film(t.tv, 'vod:11', { externalIds: { tmdb: '603' } });
    await t.services.watch.report(t.kids, item, { kind: 'stopped', key: item.key, positionMs: 20 * MINUTE });
    const [row] = await t.db.watchProgress.list(t.kids);
    expect(row).toMatchObject({ id: `${t.kids}/${identityHash('tmdb:movie:603')}`, identity: 'tmdb:movie:603', watched: false, positionMs: 20 * MINUTE, round: 0 });
    expect(row?.item?.title).toBe(item.title);
    expect((await t.db.journal.entries(head)).map((entry) => entry.entity)).toEqual(['watchProgress']);
    expect(await t.db.outbox.list()).toEqual([]);
  });

  it('counts a stop near the end as watched, and lets no report at nought lower where it got to', async () => {
    const t = await setUp();
    const item = film(t.tv, 'vod:11');
    await t.services.watch.report(t.kids, item, { kind: 'stopped', key: item.key, positionMs: 40 * MINUTE });
    await t.services.watch.report(t.kids, item, { kind: 'stopped', key: item.key, positionMs: 0 });
    expect((await t.db.watchProgress.list(t.kids))[0]?.positionMs).toBe(40 * MINUTE);
    // The engine's own length, rather than a rounded runtime, decides.
    await t.services.watch.report(t.kids, item, { kind: 'stopped', key: item.key, positionMs: 95 * MINUTE, durationMs: 100 * MINUTE });
    expect((await t.db.watchProgress.list(t.kids))[0]?.watched).toBe(true);
    // Watched holds while it is watched again.
    await t.services.watch.report(t.kids, item, { kind: 'stopped', key: item.key, positionMs: 10 * MINUTE });
    expect((await t.db.watchProgress.list(t.kids))[0]?.watched).toBe(true);
  });

  it('keeps playing progress a minute at a time, and every pause', async () => {
    const t = await setUp();
    const item = film(t.tv, 'vod:11');
    await t.services.watch.report(t.kids, item, { kind: 'started', key: item.key, positionMs: 0 });
    await t.services.watch.report(t.kids, item, { kind: 'progress', key: item.key, positionMs: 10_000, paused: false });
    const head = await t.db.journal.head();
    await t.services.watch.report(t.kids, item, { kind: 'progress', key: item.key, positionMs: 30_000, paused: false });
    expect(await t.db.journal.count(head)).toBe(0);
    await t.services.watch.report(t.kids, item, { kind: 'progress', key: item.key, positionMs: 75_000, paused: false });
    await t.services.watch.report(t.kids, item, { kind: 'progress', key: item.key, positionMs: 80_000, paused: true });
    expect(await t.db.journal.count(head)).toBe(2);
    expect((await t.db.watchProgress.list(t.kids))[0]?.positionMs).toBe(80_000);
  });

  it('knows every copy of a film by the catalogue the provider matched it to', async () => {
    const t = await setUp();
    const german = film(t.tv, 'vod:11', { title: 'Matrix (1999) DE', externalIds: { tmdb: '603' } });
    const better = film(t.tv, 'vod:12', { title: 'Matrix HQ', externalIds: { tmdb: '603' } });
    const other = film(t.tv, 'vod:13', { title: 'Inception', externalIds: { tmdb: '27205' } });
    await t.services.watch.setPlayed(t.kids, german, true);
    const kept = await t.services.watch.keptStatus(t.kids, [german, better, other]);
    expect(kept.get(`${t.tv}/vod:12`)).toMatchObject({ played: true });
    expect(kept.has(`${t.tv}/vod:13`)).toBe(false);
    // Unmarked, it is unwatched everywhere — a new round.
    await t.services.watch.setPlayed(t.kids, better, false);
    expect((await t.services.watch.keptStatus(t.kids, [german])).get(`${t.tv}/vod:11`)).toMatchObject({ played: false });
    expect((await t.db.watchProgress.list(t.kids))[0]?.round).toBe(1);
  });

  it('keeps nothing for a source that keeps its own, and lays nothing over its items', async () => {
    const t = await setUp();
    const item = film(t.home, 'm1');
    expect(await t.services.watch.keptStatus(t.kids, [item])).toEqual(new Map());
    await t.services.watch.setPlayed(t.kids, item, true);
    expect(await t.db.watchProgress.list(t.kids)).toEqual([]);
  });

  it('marks a series done, its episodes with it, and starts it all again when it is unmarked', async () => {
    const t = await setUp();
    const series = show(t.tv, 'show:1', '1396');
    const first = episode(t.tv, series, 1, 1);
    const second = episode(t.tv, series, 1, 2);
    await t.services.watch.report(t.kids, first, { kind: 'stopped', key: first.key, positionMs: 5 * MINUTE });
    await t.services.watch.setPlayed(t.kids, series, true);
    const done = await t.services.watch.keptStatus(t.kids, [first, second, series]);
    expect(done.get(`${t.tv}/${second.key.externalId}`)).toMatchObject({ played: true });
    expect(done.get(`${t.tv}/${series.key.externalId}`)).toMatchObject({ played: true });
    await t.services.watch.setPlayed(t.kids, series, false);
    const again = await t.services.watch.keptStatus(t.kids, [first, series]);
    expect(again.get(`${t.tv}/${first.key.externalId}`)).toMatchObject({ played: false });
    expect(again.get(`${t.tv}/${first.key.externalId}`)?.positionMs).toBeUndefined();
  });

  it('lists what was begun on a provider, newest first: films part-way, and series lately watched', async () => {
    const t = await setUp();
    const begun = film(t.tv, 'vod:11', { externalIds: { tmdb: '603' } });
    const finished = film(t.tv, 'vod:12', { externalIds: { tmdb: '604' } });
    await t.services.watch.report(t.kids, begun, { kind: 'stopped', key: begun.key, positionMs: 20 * MINUTE });
    await t.services.watch.setPlayed(t.kids, finished, true);
    expect((await t.services.watch.keptInProgress(t.kids, t.tv, 'movie')).map((each) => each.item.key.externalId)).toEqual(['vod:11']);

    const series = show(t.tv, 'show:1', '1396');
    await t.services.watch.report(t.kids, episode(t.tv, series, 2, 5), { kind: 'stopped', key: episode(t.tv, series, 2, 5).key, positionMs: MINUTE });
    const shows = await t.services.watch.keptInProgress(t.kids, t.tv, 'show');
    expect(shows.map((each) => [each.item.type, each.item.key.externalId, each.episode])).toEqual([['show', 'show:1', { seasonNumber: 2, episodeNumber: 5 }]]);
    // Its cover, as the episode carried it.
    expect(shows[0]?.item.images.poster).toBe('cover');
    // Nothing of another provider's.
    expect(await t.services.watch.keptInProgress(t.kids, connectionId('elsewhere'), 'show')).toEqual([]);
  });
});

describe('merging what two devices kept', () => {
  const base: WatchProgress = {
    id: 'u1/h',
    userId: userId('u1'),
    identity: 'tmdb:movie:603',
    round: 0,
    watched: false,
    positionMs: 10 * MINUTE,
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    version: 1,
  };
  const item = { type: 'movie', key: { connectionId: connectionId('c'), externalId: 'x' }, title: 'X', ratings: {}, genres: [], images: {} } as MediaItem;

  it('takes a later round whole: someone chose to start again', () => {
    const local = { ...base, watched: true, round: 0 };
    const server = { ...base, round: 1, watched: false, positionMs: 2 * MINUTE };
    expect(mergeWatchProgress(local, server, false)).toEqual(server);
    expect(mergeWatchProgress(server, local, true)).toEqual(server);
  });

  it('holds watched within a round, and takes where it got to from the last push', () => {
    const local = { ...base, watched: true, positionMs: 80 * MINUTE };
    const server = { ...base, positionMs: 12 * MINUTE, item };
    expect(mergeWatchProgress(local, server, false)).toMatchObject({ watched: true, positionMs: 12 * MINUTE, item });
  });

  it('keeps this device’s position while its own change waits to go', () => {
    const local = { ...base, positionMs: 20 * MINUTE };
    const server = { ...base, positionMs: 80 * MINUTE };
    expect(mergeWatchProgress(local, server, true).positionMs).toBe(20 * MINUTE);
    // A rewind made elsewhere reaches a device that changed nothing.
    expect(mergeWatchProgress(server, local, false).positionMs).toBe(20 * MINUTE);
  });

  it('keeps every catalogue either side knows, and the earliest start', () => {
    const local = { ...base, externalIds: { imdb: 'tt0133093' }, createdAt: '2026-10-01T10:00:00.000Z' };
    const server = { ...base, externalIds: { tmdb: '603' } };
    expect(mergeWatchProgress(local, server, false)).toMatchObject({
      externalIds: { tmdb: '603', imdb: 'tt0133093' },
      createdAt: '2026-10-01T10:00:00.000Z',
    });
  });
});
