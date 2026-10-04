import {
  AppError,
  identityHash,
  pluginId,
  type ConnectionId,
  type Episode,
  type ExternalIds,
  type IdentifyQuery,
  type Movie,
  type Plugin,
  type PluginManifest,
} from '@loge/api';
import { describe, expect, it } from 'vitest';

import { initialDraft, setSecret, setValue } from '@/services/connection-draft';

import { ENGINES, type Engine } from './support/engines';
import { fakeClock } from './support/fakes';
import { buildServices, fakeMediaPlugin } from './support/services';

const DAY = 24 * 60 * 60 * 1000;

/** A catalogue answering from a table, by type, title as asked and year; and refusing every key but "good". */
function fakeCatalogue(answers: Readonly<Record<string, ExternalIds>>) {
  const asked: string[] = [];
  const manifest: PluginManifest = {
    id: pluginId('metadata/catalogue'),
    category: 'metadata',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Catalogue',
    description: 'A catalogue that exists only in tests.',
    metadata: { identifies: ['movies', 'shows'] },
    connectionFields: [{ key: 'apiKey', label: 'Key', type: 'password', required: true }],
    settings: [],
  };
  const name = (query: IdentifyQuery) => `${query.type}:${query.originalTitle ?? query.title}:${query.year ?? ''}`;
  const plugin: Plugin = {
    manifest,
    metadata: {
      connect: async (target, context) => {
        const allowed = async () => {
          if ((await context.credentials.read()).apiKey !== 'good') throw new AppError('UNAUTHORIZED', 'Not this key.', { retry: 'never' });
        };
        return {
          connectionId: target.connectionId,
          check: async () => {
            await allowed();
            return {};
          },
          identify: async (query) => {
            asked.push(name(query));
            await allowed();
            return answers[name(query)];
          },
          dispose: async () => undefined,
        };
      },
    },
  };
  return { plugin, manifest, asked };
}

function film(connection: ConnectionId, id: string, title: string, extra: Partial<Movie> = {}): Movie {
  return { type: 'movie', key: { connectionId: connection, externalId: id }, title, ratings: {}, genres: [], images: {}, ...extra };
}

function episode(connection: ConnectionId, show: string, showTitle: string, number: number, extra: Partial<Episode> = {}): Episode {
  return {
    type: 'episode',
    key: { connectionId: connection, externalId: `${show}:1:${number}` },
    title: `Episode ${number}`,
    show: { connectionId: connection, externalId: show },
    showTitle,
    seasonNumber: 1,
    episodeNumber: number,
    ratings: {},
    genres: [],
    images: {},
    ...extra,
  };
}

describe.each(ENGINES)('what a title is, on %s', (engine: Engine) => {
  /** `key: null` sets up no metadata connection at all. */
  async function setUp(answers: Readonly<Record<string, ExternalIds>> = {}, key: string | null = 'good') {
    const clock = fakeClock();
    const portal = fakeMediaPlugin('portal', { category: 'iptv', kinds: ['live', 'movies', 'shows'], keepsNoWatchState: true });
    const files = fakeMediaPlugin('files', { keepsNoWatchState: true });
    const catalogue = fakeCatalogue(answers);
    const built = buildServices({ plugins: [portal.plugin, files.plugin, catalogue.plugin], engine, clock });
    const kids = (await built.services.profiles.create('Kids')).id;
    const draftOf = (media: typeof portal, address: string) => {
      let draft = initialDraft(media.manifest, 0);
      draft = setValue(media.manifest, draft, kids, 'fields', 'serverUrl', address);
      draft = setValue(media.manifest, draft, kids, 'fields', 'username', 'family');
      return setSecret(draft, kids, 'password', 'secret');
    };
    const connect = async (media: typeof portal) => (await built.services.connections.create(media.manifest.id, draftOf(media, 'http://home:8096'))).id;
    const keyed = (value: string) => setSecret(initialDraft(catalogue.manifest, 0), kids, 'apiKey', value);
    const lookups = key === null ? undefined : (await built.services.connections.create(catalogue.manifest.id, keyed(key))).id;
    const portalAt = (address: string) => draftOf(portal, address);
    return { ...built, clock, catalogue, kids, keyed, lookups, portalAt, tv: await connect(portal), library: await connect(files) };
  }

  it('asks what a film known only by its title is, and keeps every language’s copy as one', async () => {
    const t = await setUp({ 'movie:Der Pate:1972': { tmdb: '238' } });
    const german = film(t.tv, 'vod:21', 'Der Pate (1972) DE');
    const english = film(t.tv, 'vod:22', 'The Godfather EN', { year: 1972, externalIds: { tmdb: '238' } });
    // Watched before anyone knew what it was: kept under its title.
    await t.services.watch.setPlayed(t.kids, german, true);
    expect((await t.services.watch.keptStatus(t.kids, [english])).size).toBe(0);
    const head = await t.db.journal.head();

    expect(await t.services.identity.resolve(t.kids, [german, english])).toBe(true);
    // The copy with the portal's own id was never asked about.
    expect(t.catalogue.asked).toEqual(['movie:Der Pate:1972']);
    const [row] = await t.db.watchProgress.list(t.kids);
    expect(row).toMatchObject({ id: `${t.kids}/${identityHash('tmdb:movie:238')}`, identity: 'tmdb:movie:238', watched: true, externalIds: { tmdb: '238' } });
    expect(await t.db.watchProgress.list(t.kids)).toHaveLength(1);
    // Moved for every device of the account: the new row, and the old one gone.
    expect((await t.db.journal.entries(head)).map((entry) => `${entry.entity} ${entry.operation}`)).toEqual(['watchProgress upsert', 'watchProgress delete']);

    const kept = await t.services.watch.keptStatus(t.kids, [german, english]);
    expect(kept.get(`${t.tv}/vod:21`)).toMatchObject({ played: true });
    expect(kept.get(`${t.tv}/vod:22`)).toMatchObject({ played: true });
    // And what is played next of the German copy lands on the catalogue's row.
    await t.services.watch.setPlayed(t.kids, german, false);
    expect(await t.db.watchProgress.list(t.kids)).toMatchObject([{ identity: 'tmdb:movie:238', watched: false, round: 1 }]);
  });

  it('merges a title’s row into one the catalogue’s id already has', async () => {
    const t = await setUp({ 'movie:Der Pate:1972': { tmdb: '238' } });
    const german = film(t.tv, 'vod:21', 'Der Pate (1972) DE');
    const english = film(t.tv, 'vod:22', 'The Godfather', { year: 1972, externalIds: { tmdb: '238' }, runtimeMs: 100 * 60_000 });
    await t.services.watch.report(t.kids, english, { kind: 'stopped', key: english.key, positionMs: 10 * 60_000 });
    t.clock.advance(60_000);
    await t.services.watch.report(t.kids, german, { kind: 'stopped', key: german.key, positionMs: 30 * 60_000 });
    await t.services.identity.resolve(t.kids, [german]);
    // One row: where it got to last, under the catalogue's id.
    expect(await t.db.watchProgress.list(t.kids)).toMatchObject([{ identity: 'tmdb:movie:238', positionMs: 30 * 60_000, watched: false }]);
  });

  it('knows a series’ episodes by the series it found, asking once for all of them', async () => {
    const t = await setUp({ 'show:Haus des Geldes:2017': { tmdb: '71446' } });
    const first = episode(t.tv, 'show:9', 'Haus des Geldes (2017) DE', 1);
    const second = episode(t.tv, 'show:9', 'Haus des Geldes (2017) DE', 2);
    await t.services.watch.setPlayed(t.kids, first, true);
    expect(await t.services.identity.resolve(t.kids, [first, second])).toBe(true);
    expect(t.catalogue.asked).toEqual(['show:Haus des Geldes:2017']);
    expect(await t.db.watchProgress.list(t.kids)).toMatchObject([{ identity: 'tmdb:tv:71446/s1e1', watched: true }]);
    // Another language's copy of the series, which the portal matched itself.
    const english = episode(t.tv, 'show:10', 'Money Heist', 1, { showExternalIds: { tmdb: '71446' } });
    const kept = await t.services.watch.keptStatus(t.kids, [english, second]);
    expect(kept.get(`${t.tv}/show:10:1:1`)).toMatchObject({ played: true });
    expect(kept.has(`${t.tv}/show:9:1:2`)).toBe(false);
  });

  it('remembers what it found, and asks about a miss again only after a while', async () => {
    const t = await setUp({ 'movie:Inception:2010': { tmdb: '27205' } });
    const found = film(t.tv, 'vod:1', 'Inception (2010)');
    const missed = film(t.tv, 'vod:2', 'Nothing Like It (2001)');
    await t.services.identity.resolve(t.kids, [found, missed]);
    await t.services.identity.resolve(t.kids, [found, missed]);
    expect(t.catalogue.asked).toEqual(['movie:Inception:2010', 'movie:Nothing Like It:2001']);
    t.clock.advance(31 * DAY);
    await t.services.identity.resolve(t.kids, [found, missed]);
    expect(t.catalogue.asked).toEqual(['movie:Inception:2010', 'movie:Nothing Like It:2001', 'movie:Nothing Like It:2001']);
    // What it found is laid onto the item before it is keyed, without asking.
    expect((await t.services.identity.withKnownIds(t.kids, [found]))[0]?.externalIds).toEqual({ tmdb: '27205' });
  });

  it('asks nothing without a metadata connection', async () => {
    const t = await setUp({ 'movie:Inception:2010': { tmdb: '27205' } }, null);
    expect(await t.services.identity.resolve(t.kids, [film(t.tv, 'vod:1', 'Inception (2010)')])).toBe(false);
    expect(t.catalogue.asked).toEqual([]);
  });

  it('asks only about a provider whose watch status the app keeps — never a source’s, nor with TV switched off', async () => {
    const t = await setUp({ 'movie:Inception:2010': { tmdb: '27205' } });
    await t.services.accountSettings.setWatchStatus({ media: true });
    await t.services.identity.resolve(t.kids, [film(t.library, 'file:1', 'Inception (2010)')]);
    await t.services.accountSettings.setWatchStatus({ live: false });
    await t.services.identity.resolve(t.kids, [film(t.tv, 'vod:1', 'Inception (2010)')]);
    expect(t.catalogue.asked).toEqual([]);
  });

  it('stops at a refused key, and asks again once the key changes', async () => {
    const t = await setUp({ 'movie:Inception:2010': { tmdb: '27205' } }, 'bad');
    const item = film(t.tv, 'vod:1', 'Inception (2010)');
    expect(await t.services.identity.resolve(t.kids, [item])).toBe(false);
    expect(await t.services.identity.resolve(t.kids, [film(t.tv, 'vod:2', 'Heat (1995)')])).toBe(false);
    expect(t.catalogue.asked).toEqual(['movie:Inception:2010']);
    // Nothing was kept of the refusal: the item is asked about again under a new key.
    const lookups = t.lookups;
    if (!lookups) throw new Error('no metadata connection');
    await t.services.connections.update(lookups, t.keyed('good'));
    expect(await t.services.identity.resolve(t.kids, [item])).toBe(true);
    expect(t.catalogue.asked).toEqual(['movie:Inception:2010', 'movie:Inception:2010']);
    expect((await t.services.identity.withKnownIds(t.kids, [item]))[0]?.externalIds).toEqual({ tmdb: '27205' });
  });

  it('tries a draft’s key with Test connection', async () => {
    const t = await setUp({}, null);
    const target = (apiKey: string) => ({ pluginId: t.catalogue.manifest.id, fields: {}, settings: {}, scope: 'shared' as const, secrets: { apiKey } });
    await expect(t.services.identity.test(target('good'))).resolves.toEqual({});
    await expect(t.services.identity.test(target('bad'))).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('forgets what a provider’s items were found to be when its values change', async () => {
    const t = await setUp({ 'movie:Inception:2010': { tmdb: '27205' } });
    const item = film(t.tv, 'vod:1', 'Inception (2010)');
    await t.services.identity.resolve(t.kids, [item]);
    expect((await t.services.identity.withKnownIds(t.kids, [item]))[0]?.externalIds).toEqual({ tmdb: '27205' });
    // Another portal at that connection: its vod:1 may be another film.
    await t.services.connections.update(t.tv, t.portalAt('http://elsewhere:8096'));
    expect((await t.services.identity.withKnownIds(t.kids, [item]))[0]?.externalIds).toBeUndefined();
  });
});
