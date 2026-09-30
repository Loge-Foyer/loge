import { AppError, imageRef, type AppErrorCode, type ConnectionId, type MediaItem } from '@sc/api';
import { describe, expect, it } from 'vitest';

import { draftOf, initialDraft, setSecret, setValue } from '@/services/connection-draft';
import { fingerprintOf } from '@/services/media/pool';

import { ENGINES, reopenable, type Engine } from './support/engines';
import { fakeClock, memoryCredentialStore } from './support/fakes';
import { buildServices, fakeMediaPlugin, movie } from './support/services';

const NEWEST = { by: 'releaseDate', order: 'desc' } as const;
const MOVIES = { kind: 'movies', sort: NEWEST } as const;
const DAY = 86_400_000;

function films(connectionId: ConnectionId): MediaItem[] {
  return [2024, 2020, 2016].map((year) => movie(connectionId, `m${year}`, year, { images: { poster: imageRef(`poster-${year}`) } }));
}

async function setUp(options: { keeps?: boolean; engine?: Engine; where?: ReturnType<typeof reopenable> } = {}) {
  let failing: AppErrorCode | undefined;
  const source = fakeMediaPlugin('home', {
    movies: films,
    resume: (id) => [movie(id, 'r1', 2020, { watch: { played: false, progress: 0.5, lastPlayedAt: '2026-09-01T00:00:00Z' } })],
    children: (parent) => [movie(parent.key.connectionId, `${parent.key.externalId}-child`, 2021)],
    withImages: options.keeps ?? true,
    failWith: () => (failing ? new AppError(failing, 'The source failed.', { retry: failing === 'OFFLINE' ? 'network-change' : 'backoff' }) : undefined),
  });
  const credentials = memoryCredentialStore();
  const deviceBound = memoryCredentialStore();
  const clock = fakeClock();
  const built = buildServices({ plugins: [source.plugin], engine: options.engine ?? 'sqlite', clock, credentials, deviceBound, ...(options.where ? { where: options.where } : {}) });
  const { services } = built;
  const kids = await services.profiles.create('Kids');
  let draft = initialDraft(source.manifest, 0);
  draft = setValue(source.manifest, draft, kids.id, 'fields', 'serverUrl', 'http://home:8096');
  draft = setValue(source.manifest, draft, kids.id, 'fields', 'username', 'family');
  draft = setSecret(draft, kids.id, 'password', 'secret');
  const connection = await services.connections.create(source.manifest.id, draft);
  return {
    ...built,
    source,
    kids: kids.id,
    connection,
    credentials,
    deviceBound,
    fail: (code: AppErrorCode | undefined) => {
      failing = code;
    },
  };
}

const titles = (items: readonly MediaItem[]) => items.map((item) => item.title);

describe('what sources answered, kept on the device', () => {
  it('is saved only where the source allows it', async () => {
    const kept = await setUp();
    await kept.services.media.row(kept.kids, MOVIES, 10);
    const [live] = await kept.services.sources.forUser(kept.kids);
    if (!live) throw new Error('setup');
    expect(titles((await kept.db.mediaCache.list(kept.kids, kept.connection.id, 'row:movies:releaseDate:desc', fingerprintOf(live)))?.items ?? [])).toEqual([
      'm2024',
      'm2020',
      'm2016',
    ]);

    const notKept = await setUp({ keeps: false });
    await notKept.services.media.row(notKept.kids, MOVIES, 10);
    notKept.fail('OFFLINE');
    const offline = await notKept.services.media.row(notKept.kids, MOVIES, 10);
    expect(offline.items).toEqual([]);
    expect(offline.sourceErrors[0]?.savedAt).toBeUndefined();
  });

  it('stands in for a source that cannot answer, and says when it was saved', async () => {
    const { services, kids, clock, fail } = await setUp();
    const savedAt = clock.now();
    await services.media.row(kids, MOVIES, 10);
    await services.media.continueWatching(kids);
    clock.advance(5 * 60_000);
    fail('OFFLINE');

    const row = await services.media.row(kids, MOVIES, 10);
    expect(titles(row.items)).toEqual(['m2024', 'm2020', 'm2016']);
    expect(row.sourceErrors).toEqual([expect.objectContaining({ code: 'OFFLINE', savedAt })]);
    const resume = await services.media.continueWatching(kids);
    expect(titles(resume.items)).toEqual(['r1']);
    expect(resume.sourceErrors[0]?.savedAt).toBe(savedAt);
  });

  it('is shown before the source answers — and never after the values it was saved under changed', async () => {
    const { services, kids, source, connection } = await setUp();
    expect(await services.media.saved.row(kids, MOVIES, 10)).toBeNull();
    await services.media.row(kids, MOVIES, 10);
    expect(titles((await services.media.saved.row(kids, MOVIES, 10))?.items ?? [])).toEqual(['m2024', 'm2020', 'm2016']);

    // A different server: what the old one answered no longer holds.
    const stored = await services.connections.edit(connection.id);
    if (!stored) throw new Error('setup');
    await services.connections.update(
      connection.id,
      setValue(source.manifest, draftOf(source.manifest, stored), kids, 'fields', 'serverUrl', 'http://elsewhere:8096'),
    );
    expect(await services.media.saved.row(kids, MOVIES, 10)).toBeNull();
  });

  it('is deleted when the switch that allows it goes off', async () => {
    const { services, kids, source, connection, db } = await setUp();
    await services.media.row(kids, MOVIES, 10);
    const stored = await services.connections.edit(connection.id);
    if (!stored) throw new Error('setup');
    await services.connections.update(connection.id, setValue(source.manifest, draftOf(source.manifest, stored), kids, 'settings', 'cacheMetadata', false));
    const [live] = await services.sources.forUser(kids);
    if (!live) throw new Error('setup');
    expect(await db.mediaCache.list(kids, connection.id, 'row:movies:releaseDate:desc', fingerprintOf(live))).toBeUndefined();
    // And nothing new is kept while it is off.
    await services.media.row(kids, MOVIES, 10);
    expect(await db.mediaCache.list(kids, connection.id, 'row:movies:releaseDate:desc', fingerprintOf(live))).toBeUndefined();
  });

  it('purges, the first time a source cannot keep it, whatever a racing write left behind', async () => {
    const { services, kids, connection, db } = await setUp({ keeps: false });
    const [live] = await services.sources.forUser(kids);
    if (!live) throw new Error('setup');
    await db.mediaCache.putList(kids, connection.id, 'resume', fingerprintOf(live), { items: films(connection.id), savedAt: 1 });
    await services.media.row(kids, MOVIES, 10);
    expect(await db.mediaCache.list(kids, connection.id, 'resume', fingerprintOf(live))).toBeUndefined();
  });

  it('shows a saved first grid page when the source is gone, and never pages on from it', async () => {
    const { services, kids, fail } = await setUp();
    await services.media.gridPage(kids, MOVIES, null, 2);
    fail('OFFLINE');
    const page = await services.media.gridPage(kids, MOVIES, null, 2);
    expect(titles(page.items)).toEqual(['m2024', 'm2020']);
    expect(page.sourceErrors[0]?.savedAt).toBeDefined();
    expect(page.next).toBeUndefined();

    const saved = await services.media.saved.gridFirstPage(kids, MOVIES, 60);
    expect(titles(saved?.items ?? [])).toEqual(['m2024', 'm2020']);
    expect(saved?.next).toBeUndefined();
  });

  it('keeps detail pages and episode lists already opened, and drops one the source no longer has', async () => {
    const { services, kids, connection, fail } = await setUp();
    const key = { connectionId: connection.id, externalId: 'm2020' };
    const opened = await services.media.item(kids, key);
    expect(opened.sourceError).toBeUndefined();
    const parent = opened.detail.item;
    await services.media.children(kids, parent);

    fail('OFFLINE');
    const offline = await services.media.item(kids, key);
    expect(offline.detail.item.title).toBe('m2020');
    expect(offline.sourceError).toMatchObject({ code: 'OFFLINE', savedAt: expect.any(Number) });
    expect(titles((await services.media.children(kids, parent)).items)).toEqual(['m2020-child']);

    fail('NOT_FOUND');
    services.media.unpark();
    await expect(services.media.item(kids, key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    fail('PROVIDER_UNAVAILABLE');
    await expect(services.media.item(kids, key)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('forgets details and episode lists nobody opened for a month, and keeps the rows', async () => {
    const { services, kids, connection, clock, db } = await setUp();
    const key = { connectionId: connection.id, externalId: 'm2020' };
    await services.media.row(kids, MOVIES, 10);
    const opened = await services.media.item(kids, key);
    await services.media.children(kids, opened.detail.item);
    clock.advance(31 * DAY);
    await services.media.prune();

    const [live] = await services.sources.forUser(kids);
    if (!live) throw new Error('setup');
    expect(await db.mediaCache.detail(kids, key, fingerprintOf(live))).toBeUndefined();
    expect(await db.mediaCache.list(kids, connection.id, 'children:m2020', fingerprintOf(live))).toBeUndefined();
    expect(await services.media.saved.row(kids, MOVIES, 10)).not.toBeNull();
  });

  it.each(ENGINES)('comes back after a restart with its artwork, before the source is asked (%s)', async (engine) => {
    const where = reopenable(engine);
    const first = await setUp({ engine, where });
    await first.services.media.row(first.kids, MOVIES, 10);

    // A new launch on the same database: nothing has asked the source yet.
    const again = buildServices({
      plugins: [first.source.plugin],
      engine,
      where,
      credentials: first.credentials,
      deviceBound: first.deviceBound,
    }).services;
    const saved = await again.media.saved.row(first.kids, MOVIES, 10);
    expect(titles(saved?.items ?? [])).toEqual(['m2024', 'm2020', 'm2016']);
    const poster = saved?.items[0]?.images.poster;
    if (!poster) throw new Error('setup');
    expect(again.media.artwork(first.kids, first.connection.id, poster, { width: 200 })).toMatchObject({
      uri: expect.stringContaining('poster-2024'),
      cachePolicy: 'memory-disk',
    });
  });
});
