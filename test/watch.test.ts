import { AppError, type ConnectionId, type MediaItem } from '@loge/api';
import { afterEach, describe, expect, it } from 'vitest';

import { initialDraft, setSecret, setValue } from '@/services/connection-draft';
import { checkRestoredDevice } from '@/services/restored-device';

import { testCrypto } from './support/crypto';
import { ENGINES, type Engine } from './support/engines';
import { fakeNetwork, silentLog } from './support/fakes';
import { buildServices, fakeMediaPlugin, movie } from './support/services';

const MINUTE = 60_000;
const NEWEST = { kinds: ['movies'], sort: { by: 'releaseDate', order: 'desc' } } as const;
const running: { stop(): void }[] = [];
afterEach(() => {
  for (const drainer of running.splice(0)) drainer.stop();
});

function film(connectionId: ConnectionId, id = 'm1', extra: Partial<Parameters<typeof movie>[3]> = {}): MediaItem {
  return movie(connectionId, id, 2020, { runtimeMs: 100 * MINUTE, ...extra });
}

describe.each(ENGINES)('watch status on %s', (engine: Engine) => {
  async function setUp(options: { keeps?: boolean; writes?: boolean } = {}) {
    let failing: AppError | undefined;
    let refusing: AppError | undefined;
    let resume: (id: ConnectionId) => readonly MediaItem[] = () => [];
    const source = fakeMediaPlugin('home', {
      movies: (id) => [film(id)],
      resume: (id) => resume(id),
      withImages: options.keeps ?? true,
      writesWatchState: options.writes ?? true,
      failWith: () => failing,
      failWritesWith: () => refusing,
    });
    const network = fakeNetwork();
    const built = buildServices({ plugins: [source.plugin], engine, network });
    running.push(built.drainer);
    const kids = await built.services.profiles.create('Kids');
    let draft = initialDraft(source.manifest, 0);
    draft = setValue(source.manifest, draft, kids.id, 'fields', 'serverUrl', 'http://home:8096');
    draft = setValue(source.manifest, draft, kids.id, 'fields', 'username', 'family');
    draft = setSecret(draft, kids.id, 'password', 'secret');
    const connection = await built.services.connections.create(source.manifest.id, draft);
    return {
      ...built,
      source,
      kids: kids.id,
      item: film(connection.id),
      fail: (error: AppError | undefined) => {
        failing = error;
      },
      refuseWrites: (error: AppError | undefined) => {
        refusing = error;
      },
      resumeWith: (next: (id: ConnectionId) => readonly MediaItem[]) => {
        resume = next;
      },
    };
  }

  const offline = () => new AppError('OFFLINE', 'No network.', { retry: 'network-change' });

  it('marks watched in airplane mode: the cache and the outbox together, and the saved row shows it', async () => {
    const t = await setUp();
    await t.services.media.row(t.kids, NEWEST, 10);
    t.fail(offline());
    await t.services.watch.setPlayed(t.kids, t.item, true);
    expect((await t.db.outbox.list()).map((entry) => entry.report)).toEqual([{ kind: 'played', key: t.item.key, played: true }]);
    expect((await t.db.watchStatus.get(t.kids, t.item.key))?.status).toMatchObject({ played: true });
    await t.drainer.drain();
    expect(t.source.stats.reports).toEqual([]);
    expect(await t.db.outbox.list()).toHaveLength(1);
    // The source is parked now: the saved row stands in, with this device's word on it.
    const row = await t.services.media.row(t.kids, NEWEST, 10);
    expect(row.items[0]?.watch).toMatchObject({ played: true });
    expect(row.sourceErrors).toHaveLength(1);
  });

  it('delivers once the network is back — once, and never again', async () => {
    const t = await setUp();
    t.fail(offline());
    await t.services.watch.setPlayed(t.kids, t.item, true);
    await t.drainer.drain();
    t.fail(undefined);
    t.drainer.start();
    t.network.set('cellular');
    await t.drainer.drain();
    expect(t.source.stats.reports).toEqual(['m1 played true']);
    expect(await t.db.outbox.list()).toEqual([]);
    await t.drainer.drain();
    expect(t.source.stats.reports).toEqual(['m1 played true']);
  });

  it('sends an evening offline as a start and a stop, not every ten seconds of it', async () => {
    const t = await setUp();
    t.fail(offline());
    await t.services.watch.report(t.kids, t.item, { kind: 'started', key: t.item.key, positionMs: 0 });
    for (let minute = 1; minute <= 30; minute += 1) {
      await t.services.watch.report(t.kids, t.item, { kind: 'progress', key: t.item.key, positionMs: minute * MINUTE, paused: false });
    }
    await t.services.watch.report(t.kids, t.item, { kind: 'stopped', key: t.item.key, positionMs: 31 * MINUTE });
    t.fail(undefined);
    t.services.media.unpark();
    await t.drainer.drain();
    expect(t.source.stats.reports).toEqual(['m1 started 0', `m1 stopped ${31 * MINUTE}`]);
  });

  it('parks a source that refused its sign-in, and asks it nothing more until the user acts', async () => {
    const t = await setUp();
    t.fail(new AppError('UNAUTHORIZED', 'Refused.', { retry: 'never' }));
    await t.services.watch.setPlayed(t.kids, t.item, true);
    await t.drainer.drain();
    const calls = t.source.stats.calls;
    await t.drainer.drain();
    await t.drainer.drain();
    expect(t.source.stats.calls).toBe(calls);
    expect(await t.db.outbox.list()).toHaveLength(1);
    // Pull to refresh: the user acted.
    t.fail(undefined);
    t.services.media.unpark();
    await t.drainer.drain();
    expect(t.source.stats.reports).toEqual(['m1 played true']);
  });

  it('backs off from a source that is starting up, and tries again later', async () => {
    const t = await setUp();
    t.fail(new AppError('PROVIDER_UNAVAILABLE', 'Starting.', { retry: 'backoff' }));
    await t.services.watch.setPlayed(t.kids, t.item, true);
    await t.drainer.drain();
    const [deferred] = await t.db.outbox.list();
    expect(deferred).toMatchObject({ attempts: 1, notBefore: t.clock.now() + 30_000 });
    const calls = t.source.stats.calls;
    await t.drainer.drain();
    expect(t.source.stats.calls).toBe(calls);
    t.fail(undefined);
    t.clock.advance(30_000);
    await t.drainer.drain();
    expect(t.source.stats.reports).toEqual(['m1 played true']);
  });

  it('drops a report about an item the source no longer has', async () => {
    const t = await setUp();
    t.fail(new AppError('NOT_FOUND', 'Gone.'));
    await t.services.watch.setPlayed(t.kids, t.item, true);
    await t.drainer.drain();
    expect(await t.db.outbox.list()).toEqual([]);
  });

  it('puts what was watched here in Continue Watching before the source hears — and takes the source’s word after', async () => {
    const t = await setUp();
    t.fail(offline());
    await t.services.watch.report(t.kids, t.item, { kind: 'stopped', key: t.item.key, positionMs: 20 * MINUTE });
    const offlineRow = await t.services.media.continueWatching(t.kids);
    expect(offlineRow.items.map((item) => [item.key.externalId, item.watch?.positionMs, item.watch?.progress])).toEqual([['m1', 20 * MINUTE, 0.2]]);
    expect(await t.services.media.saved.continueWatching(t.kids)).toMatchObject({ items: [{ key: t.item.key }] });

    t.fail(undefined);
    t.services.media.unpark();
    await t.drainer.drain();
    // Heard: the source's resume list is the truth again, and this one says it kept no position.
    expect((await t.services.media.continueWatching(t.kids)).items).toEqual([]);
  });

  it('takes an item marked watched here out of the source’s resume list', async () => {
    const t = await setUp();
    t.resumeWith((id) => [film(id, 'm1', { watch: { played: false, positionMs: 10 * MINUTE, lastPlayedAt: '2026-09-01T00:00:00Z' } })]);
    expect((await t.services.media.continueWatching(t.kids)).items).toHaveLength(1);
    // The source answers, but backs off from taking anything back: the outbox still holds this device's word.
    t.refuseWrites(new AppError('PROVIDER_UNAVAILABLE', 'Busy.', { retry: 'backoff' }));
    await t.services.watch.setPlayed(t.kids, t.item, true);
    await t.drainer.drain();
    expect(await t.db.outbox.list()).toHaveLength(1);
    expect((await t.services.media.continueWatching(t.kids)).items).toEqual([]);
  });

  it('counts a stop near the end as watched, here too', async () => {
    const t = await setUp();
    t.fail(offline());
    await t.services.watch.report(t.kids, t.item, { kind: 'stopped', key: t.item.key, positionMs: 95 * MINUTE });
    expect((await t.db.watchStatus.get(t.kids, t.item.key))?.status).toEqual({ played: true, lastPlayedAt: expect.any(String) });
  });

  it('queues nothing for a source that cannot keep watch state', async () => {
    const t = await setUp({ writes: false });
    await t.services.watch.setPlayed(t.kids, t.item, true);
    expect(await t.db.outbox.list()).toEqual([]);
    expect(await t.db.watchStatus.list(t.kids)).toEqual([]);
  });

  it('keeps an item’s title and artwork only where its metadata may be kept', async () => {
    const t = await setUp({ keeps: false });
    t.fail(offline());
    await t.services.watch.report(t.kids, t.item, { kind: 'stopped', key: t.item.key, positionMs: 20 * MINUTE });
    expect((await t.db.watchStatus.get(t.kids, t.item.key))?.item).toBeUndefined();
    expect(await t.db.outbox.list()).toHaveLength(1);
    expect((await t.services.media.continueWatching(t.kids)).items).toEqual([]);
  });

  it('tells screens of a stop or a watched state, and not of progress along the way', async () => {
    const t = await setUp();
    const heard: string[] = [];
    t.services.watch.subscribe(({ key }) => heard.push(key.externalId));
    await t.services.watch.report(t.kids, t.item, { kind: 'progress', key: t.item.key, positionMs: MINUTE, paused: false });
    await t.services.watch.report(t.kids, t.item, { kind: 'stopped', key: t.item.key, positionMs: 2 * MINUTE });
    await t.services.watch.setPlayed(t.kids, t.item, false);
    expect(heard).toEqual(['m1', 'm1']);
  });

  it('drops the outbox of a phone restored from another’s backup: its old positions would overwrite newer ones', async () => {
    const t = await setUp();
    const check = (key: string) => checkRestoredDevice({ db: t.db, deviceKey: async () => key, sha256: testCrypto().sha256, log: silentLog });
    expect(await check('key-of-this-phone')).toBe('first');
    t.fail(offline());
    await t.services.watch.report(t.kids, t.item, { kind: 'stopped', key: t.item.key, positionMs: 20 * MINUTE });
    expect(await check('key-of-the-new-phone')).toBe('restored');
    expect(await t.db.outbox.list()).toEqual([]);
  });
});
