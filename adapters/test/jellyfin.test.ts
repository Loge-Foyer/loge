import {
  AppError,
  canPlay,
  connectionId,
  imageRef,
  headersRef,
  TransportError,
  type ConnectedMediaProvider,
  type Credentials,
  type Episode,
  type FieldValues,
  type ItemPage,
  type NetworkKind,
  type PlaybackRequest,
  type PlaybackSource,
  type PlayerProfile,
  type Season,
  type Show,
} from '@loge/api';
import { plugin } from '@loge/source-jellyfin';
import { describe, expect, it } from 'vitest';

import { fnv1a64 } from '../sources/jellyfin/src/hash';
import { bucket } from '../sources/jellyfin/src/images';
import { normalizeBaseUrl } from '../sources/jellyfin/src/url';
import * as fixtures from './fixtures/jellyfin';
import { fakeContext, fakeHttp, target, type Route } from './support/fake-http';

const SERVER = 'http://jf.test:8096';
const SIGN_IN: Readonly<Record<string, Route>> = {
  'POST /Users/AuthenticateByName': { status: 200, json: fixtures.authentication },
};

async function connect(options: {
  routes: Readonly<Record<string, Route>>;
  fields?: FieldValues;
  settings?: FieldValues;
  network?: NetworkKind;
  session?: string;
  credentials?: Credentials;
}) {
  const http = fakeHttp({ ...SIGN_IN, ...options.routes });
  const fake = fakeContext({
    http: http.client,
    ...(options.network ? { network: options.network } : {}),
    ...(options.session ? { session: options.session } : {}),
    ...(options.credentials ? { credentials: options.credentials } : {}),
  });
  const media = plugin.media;
  if (!media) throw new Error('The Jellyfin plugin has no media role.');
  const provider = await media.connect(
    target({ serverUrl: SERVER, localOnly: true, username: 'alex', ...options.fields }, options.settings ?? {}),
    fake.context,
  );
  return { provider, http, fake };
}

function listMovies(provider: ConnectedMediaProvider, cursor?: string): Promise<ItemPage> {
  const listItems = provider.listItems;
  if (!listItems) throw new Error('listItems is missing');
  return listItems({
    kind: 'movies',
    sort: { by: 'releaseDate', order: 'desc' },
    limit: 3,
    ...(cursor ? { cursor } : {}),
  });
}

describe('Jellyfin — base address', () => {
  it('reduces a pasted web-client address to the API base', () => {
    expect(normalizeBaseUrl(' http://host:8096/web/#/home.html ')).toBe('http://host:8096');
    expect(normalizeBaseUrl('https://media.example.org/jellyfin/web/index.html?x=1')).toBe(
      'https://media.example.org/jellyfin',
    );
    expect(normalizeBaseUrl('http://host:8096///')).toBe('http://host:8096');
  });
});

describe('Jellyfin — signing in', () => {
  it('sends the MediaBrowser header with encoded values and a device id per install and user', async () => {
    const { provider, http } = await connect({ routes: { 'GET /Users/Me': { status: 200, json: fixtures.me }, 'GET /System/Info/Public': { status: 200, json: fixtures.publicInfo } } });
    await provider.check();
    const [login] = http.to('POST /Users/AuthenticateByName');
    const deviceId = fnv1a64('install-1|alex');
    expect(login?.headers.Authorization).toBe(
      `MediaBrowser Client="Loge", Device="Test%20Phone", DeviceId="${deviceId}", Version="1.0.0"`,
    );
    expect(JSON.parse(login?.body ?? '{}')).toEqual({ Username: 'alex', Pw: 'secret' });
    expect(http.to('GET /Users/Me')[0]?.headers.Authorization).toContain('Token="token-1"');
    expect(fnv1a64('install-1|kid')).not.toBe(deviceId);
  });

  it('reports the server name and version from check()', async () => {
    const { provider } = await connect({
      routes: { 'GET /System/Info/Public': { status: 200, json: fixtures.publicInfo }, 'GET /Users/Me': { status: 200, json: fixtures.me } },
    });
    await expect(provider.check()).resolves.toEqual({ serverName: 'Home server', version: '12.0.0' });
  });

  it('reuses a saved session instead of signing in', async () => {
    const { provider, http } = await connect({
      routes: { 'GET /UserViews': { status: 200, json: fixtures.views } },
      session: JSON.stringify({ token: 'saved-token', userId: 'user-1' }),
    });
    await provider.getLibraries?.();
    expect(http.to('POST /Users/AuthenticateByName')).toHaveLength(0);
    expect(http.to('GET /UserViews')[0]?.headers.Authorization).toContain('Token="saved-token"');
  });

  it('signs in once for requests that start together', async () => {
    const { provider, http, fake } = await connect({
      routes: { 'GET /Items': { status: 200, json: fixtures.page([fixtures.movie]) } },
    });
    await Promise.all([listMovies(provider), listMovies(provider), listMovies(provider)]);
    expect(http.to('POST /Users/AuthenticateByName')).toHaveLength(1);
    expect(JSON.parse(fake.session() ?? '{}')).toEqual({ token: 'token-1', userId: 'user-1' });
  });

  it('signs in again once when a saved token stops working, then gives up without looping', async () => {
    const { provider, http, fake } = await connect({
      routes: { 'GET /UserViews': { status: 401 } },
      session: JSON.stringify({ token: 'stale', userId: 'user-1' }),
    });
    const error = await provider.getLibraries?.().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'UNAUTHORIZED', retry: 'never' });
    expect(http.to('POST /Users/AuthenticateByName')).toHaveLength(1);
    expect(http.to('GET /UserViews')).toHaveLength(2);
    expect(fake.session()).toBeUndefined();
  });

  it('never tries a refused password twice', async () => {
    const { provider, http } = await connect({
      routes: { 'POST /Users/AuthenticateByName': { status: 401 }, 'GET /UserViews': { status: 200, json: fixtures.views } },
    });
    await expect(provider.getLibraries?.()).rejects.toMatchObject({ code: 'UNAUTHORIZED', retry: 'never' });
    await expect(provider.getLibraries?.()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(http.to('POST /Users/AuthenticateByName')).toHaveLength(1);
  });
});

describe('Jellyfin — local network only', () => {
  it('fails on mobile data without making a request', async () => {
    const { provider, http } = await connect({ routes: {}, network: 'cellular' });
    await expect(provider.check()).rejects.toMatchObject({
      code: 'OFFLINE',
      retry: 'network-change',
      reason: 'local-network-only',
    });
    expect(http.requests).toHaveLength(0);
  });

  it('is used on mobile data when it is not local-only', async () => {
    const { provider, http } = await connect({
      routes: { 'GET /System/Info/Public': { status: 200, json: fixtures.publicInfo }, 'GET /Users/Me': { status: 200, json: fixtures.me } },
      network: 'cellular',
      fields: { localOnly: false },
    });
    await provider.check();
    expect(http.requests.length).toBeGreaterThan(0);
    expect(http.requests[0]?.timeoutMs).toBe(20_000);
  });

  it('waits for another network when a local-only server cannot be reached', async () => {
    const { provider } = await connect({
      routes: { 'GET /System/Info/Public': new TransportError('timeout') },
    });
    const error = await provider.check().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'TIMEOUT', retry: 'network-change' });
    // Not on mobile data: the server may be down, or this may be someone else's network.
    expect(error).not.toHaveProperty('reason', 'local-network-only');
  });

  it('backs off instead for a server out on the internet', async () => {
    const { provider } = await connect({
      routes: { 'GET /System/Info/Public': new TransportError('unreachable') },
      fields: { localOnly: false },
    });
    await expect(provider.check()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff' });
  });

  it('gives a local server a short timeout', async () => {
    const { provider, http } = await connect({
      routes: { 'GET /System/Info/Public': { status: 200, json: fixtures.publicInfo }, 'GET /Users/Me': { status: 200, json: fixtures.me } },
    });
    await provider.check();
    expect(http.requests[0]?.timeoutMs).toBe(6_000);
  });
});

describe('Jellyfin — listing', () => {
  it('asks for one kind, recursively, in the requested order', async () => {
    const { provider, http } = await connect({ routes: { 'GET /Items': { status: 200, json: fixtures.page([fixtures.movie]) } } });
    await listMovies(provider);
    const [request] = http.to('GET /Items');
    expect(request?.query).toMatchObject({
      userId: 'user-1',
      includeItemTypes: 'Movie',
      recursive: 'true',
      collapseBoxSetItems: 'false',
      sortBy: 'PremiereDate,SortName',
      sortOrder: 'Descending,Ascending',
      startIndex: '0',
      limit: '3',
      enableUserData: 'true',
    });
    expect(request?.query.parentId).toBeUndefined();
  });

  it('sorts titles with a single key', async () => {
    const { provider, http } = await connect({ routes: { 'GET /Items': { status: 200, json: fixtures.page([]) } } });
    await provider.listItems?.({ kind: 'shows', sort: { by: 'title', order: 'asc' }, limit: 10 });
    expect(http.to('GET /Items')[0]?.query).toMatchObject({
      includeItemTypes: 'Series',
      sortBy: 'SortName',
      sortOrder: 'Ascending',
    });
  });

  it('returns nothing for a kind it does not bring', async () => {
    const { provider, http } = await connect({ routes: {} });
    await expect(
      provider.listItems?.({ kind: 'videos', sort: { by: 'title', order: 'asc' }, limit: 10 }),
    ).resolves.toEqual({ items: [] });
    expect(http.requests).toHaveLength(0);
  });

  it('limits a listing to the chosen libraries that hold the kind', async () => {
    const { provider, http } = await connect({
      routes: { 'GET /UserViews': { status: 200, json: fixtures.views }, 'GET /Items': { status: 200, json: fixtures.page([]) } },
      settings: { libraries: { mode: 'except', ids: ['lib-movies'] } },
    });
    await listMovies(provider);
    await provider.listItems?.({ kind: 'shows', sort: { by: 'title', order: 'asc' }, limit: 5 });
    const parents = http.to('GET /Items').map((request) => `${request.query.includeItemTypes}:${request.query.parentId}`);
    expect(parents).toEqual(['Movie:lib-mixed', 'Series:lib-shows', 'Series:lib-mixed']);
    expect(http.to('GET /UserViews')).toHaveLength(1);
  });

  it('pages across libraries in order, with no duplicates or gaps', async () => {
    const byLibrary: Readonly<Record<string, readonly number[]>> = {
      'lib-movies': [2024, 2020, 2016, 2012],
      'lib-mixed': [2022, 2018, 2014],
    };
    const { provider } = await connect({
      routes: {
        'GET /UserViews': { status: 200, json: fixtures.views },
        'GET /Items': (request) => {
          const years = byLibrary[request.query.parentId ?? ''] ?? [];
          const start = Number(request.query.startIndex);
          const slice = years.slice(start, start + Number(request.query.limit));
          return { status: 200, json: fixtures.page(slice.map((year) => fixtures.film(`film-${year}`, year)), years.length) };
        },
      },
      settings: { libraries: { mode: 'only', ids: ['lib-movies', 'lib-mixed'] } },
    });
    const seen: string[] = [];
    let page = await listMovies(provider);
    seen.push(...page.items.map((item) => item.key.externalId));
    expect(page.total).toBe(7);
    while (page.nextCursor) {
      page = await listMovies(provider, page.nextCursor);
      seen.push(...page.items.map((item) => item.key.externalId));
    }
    expect(seen).toEqual(['film-2024', 'film-2022', 'film-2020', 'film-2018', 'film-2016', 'film-2014', 'film-2012']);
  });

  it('refuses a cursor made for other libraries', async () => {
    const { provider } = await connect({
      routes: { 'GET /UserViews': { status: 200, json: fixtures.views }, 'GET /Items': { status: 200, json: fixtures.page([]) } },
      settings: { libraries: { mode: 'only', ids: ['lib-movies'] } },
    });
    await expect(listMovies(provider, JSON.stringify({ v: 1, scope: 'all', offsets: [3] }))).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('lists only libraries of films and series', async () => {
    const { provider } = await connect({ routes: { 'GET /UserViews': { status: 200, json: fixtures.views } } });
    await expect(provider.getLibraries?.()).resolves.toEqual([
      { id: 'lib-movies', name: 'Films', kinds: ['movies'] },
      { id: 'lib-shows', name: 'Series', kinds: ['shows'] },
      { id: 'lib-mixed', name: 'Family', kinds: ['movies', 'shows'] },
    ]);
  });
});

describe('Jellyfin — mapping', () => {
  it('maps a film with ratings, progress and artwork', async () => {
    const { provider } = await connect({ routes: { 'GET /Items': { status: 200, json: fixtures.page([fixtures.movie]) } } });
    const [item] = (await listMovies(provider)).items;
    expect(item).toMatchObject({
      type: 'movie',
      key: { connectionId: 'connection-1', externalId: 'm-arrival' },
      title: 'Arrival',
      sortTitle: 'arrival',
      year: 2016,
      releaseDate: '2016-11-10',
      addedAt: '2024-03-01T10:20:30.123Z',
      runtimeMs: 6_960_000,
      contentRating: 'PG-13',
      ratings: { community: 7.9, critic: 94 },
      watch: { played: false, positionMs: 3_480_000, progress: 0.5, favorite: true, lastPlayedAt: '2026-09-20T20:00:00.000Z' },
    });
    expect(item?.images).toEqual({
      poster: `i/m-arrival/Primary/-/poster-tag/${encodeURIComponent('LEHV6nWB2yk8pyo0adR*.7kCMdnj')}`,
      backdrop: 'i/m-arrival/Backdrop/0/backdrop-tag',
      thumb: 'i/m-arrival/Thumb/-/thumb-tag',
      logo: 'i/m-arrival/Logo/-/logo-tag',
    });
  });

  it('treats a rating of 0 as no rating, and a watched film as having no bar', async () => {
    const { provider } = await connect({ routes: { 'GET /Items': { status: 200, json: fixtures.page([fixtures.unratedMovie]) } } });
    const [item] = (await listMovies(provider)).items;
    expect(item?.ratings).toEqual({});
    expect(item?.watch).toEqual({ played: true, favorite: false });
  });

  it('maps a series with the share of episodes watched', async () => {
    const { provider } = await connect({ routes: { 'GET /Items': { status: 200, json: fixtures.page([fixtures.series]) } } });
    const [show] = (await provider.listItems?.({ kind: 'shows', sort: { by: 'title', order: 'asc' }, limit: 5 }))?.items ?? [];
    expect(show).toMatchObject({ type: 'show', status: 'continuing', seasonCount: 2, ratings: { community: 8.7 } });
    expect((show as Show).watch?.progress).toBeCloseTo(0.3333, 3);
    expect((show as Show).watch?.unplayedCount).toBe(12);
  });

  it('lists a show’s seasons and a season’s episodes, with the series artwork', async () => {
    const { provider, http } = await connect({
      routes: {
        'GET /Items': { status: 200, json: fixtures.page([fixtures.series]) },
        'GET /Shows/s-severance/Seasons': { status: 200, json: fixtures.page([fixtures.season]) },
        'GET /Shows/s-severance/Episodes': { status: 200, json: fixtures.page([fixtures.episode]) },
      },
    });
    const [show] = (await provider.listItems?.({ kind: 'shows', sort: { by: 'title', order: 'asc' }, limit: 5 }))?.items ?? [];
    if (!show || !provider.getChildren) throw new Error('missing show');
    const [season] = (await provider.getChildren(show)).items;
    expect(season).toMatchObject({
      type: 'season',
      seasonNumber: 1,
      showTitle: 'Severance',
      show: { externalId: 's-severance' },
      images: { poster: 'i/se-1/Primary/-/season-poster' },
    });
    const [episode] = (await provider.getChildren(season as Season)).items;
    expect(http.to('GET /Shows/s-severance/Episodes')[0]?.query).toMatchObject({ seasonId: 'se-1', isMissing: 'false' });
    expect(episode).toMatchObject({
      type: 'episode',
      showTitle: 'Severance',
      seasonNumber: 1,
      episodeNumber: 1,
      airDate: '2022-02-18',
      show: { externalId: 's-severance' },
      season: { externalId: 'se-1' },
      watch: { positionMs: 1_710_000, progress: 0.5 },
    });
    expect((episode as Episode).images).toEqual({
      poster: 'i/s-severance/Primary/-/series-poster',
      thumb: 'i/ep-1/Primary/-/episode-still',
      backdrop: 'i/s-severance/Backdrop/0/series-backdrop',
      logo: 'i/s-severance/Logo/-/series-logo',
    });
  });

  it('maps a detail page with people, studios and catalogue ids', async () => {
    const { provider } = await connect({ routes: { 'GET /Items/m-arrival': { status: 200, json: fixtures.movieDetail } } });
    const detail = await provider.getItem?.('m-arrival');
    expect(detail).toMatchObject({
      tagline: 'Why are they here?',
      studios: ['Paramount'],
      item: { externalIds: { imdb: 'tt2543164', tmdb: '329865' } },
      people: [
        { name: 'Amy Adams', role: 'Louise Banks', kind: 'actor', image: 'i/person-1/Primary/-/amy-tag' },
        { name: 'Denis Villeneuve', kind: 'director' },
        { name: 'Someone', kind: 'other' },
      ],
    });
    expect(detail?.item.overview).toContain('linguist');
    expect(detail?.item.genres).toEqual(['Drama', 'Science Fiction']);
  });

  it('asks for the file itself, and says what it is', async () => {
    const { provider, http } = await connect({ routes: { 'GET /Items/m-arrival': { status: 200, json: fixtures.movieDetail } } });
    const detail = await provider.getItem?.('m-arrival');
    // Without `fields`, a server is free to leave MediaSources out.
    expect(http.to('GET /Items/m-arrival')[0]?.query.fields).toContain('MediaSources');

    const version = detail?.versions?.[0];
    expect(version?.id).toBe('source-4k');
    expect(version?.label).toBe('2160p HDR');
    expect(version?.container).toBe('mkv');
    expect(version?.sizeBytes).toBe(68_719_476_736);
    expect(version?.durationMs).toBe(7_098_000);
    expect(version?.video).toMatchObject({
      codec: 'hevc',
      width: 3840,
      height: 2160,
      bitDepth: 10,
      frameRate: 23.976,
      profile: 'Main 10',
      hdr: 'dolby-vision',
    });
  });

  it('calls a file by the name a person would, not ffprobe’s first guess', async () => {
    const { provider } = await connect({
      routes: {
        'GET /Items/m-arrival': {
          status: 200,
          json: {
            ...fixtures.movieDetail,
            MediaSources: [{ Id: 's', Container: 'mov,mp4,m4a,3gp,3g2,mj2', MediaStreams: [] }],
          },
        },
      },
    });
    // `mov` is first in the family list and is the least likely truth.
    expect((await provider.getItem?.('m-arrival'))?.versions?.[0]?.container).toBe('mp4');
  });

  it('calls Atmos Atmos, and only where the server does', async () => {
    const { provider } = await connect({ routes: { 'GET /Items/m-arrival': { status: 200, json: fixtures.movieDetail } } });
    const audio = (await provider.getItem?.('m-arrival'))?.versions?.[0]?.audio ?? [];
    // Atmos rides inside TrueHD and E-AC-3 alike, so the codec cannot say:
    // only AudioSpatialFormat can, and `None` means no.
    expect(audio[0]).toMatchObject({ codec: 'truehd', language: 'en', channels: 8, channelLayout: '7.1', spatial: 'dolby-atmos', default: true });
    expect(audio[1]).toMatchObject({ codec: 'eac3', language: 'de', channelLayout: '5.1' });
    expect(audio[1]?.spatial).toBeUndefined();
  });

  it('tells DTS:X from Atmos, and keeps an unknown report as a report', async () => {
    const spatialSource = (format: string) => ({
      ...fixtures.movieDetail,
      MediaSources: [
        {
          Id: 's',
          MediaStreams: [{ Index: 0, Type: 'Audio', Codec: 'dts', AudioSpatialFormat: format, IsDefault: true, IsForced: false }],
        },
      ],
    });
    for (const [format, expected] of [
      ['DTSX', 'dts-x'],
      ['DolbyAtmos', 'dolby-atmos'],
      // A name this client does not know is still a report that there is one.
      ['SomethingNew', 'other'],
    ] as const) {
      const { provider } = await connect({ routes: { 'GET /Items/m-arrival': { status: 200, json: spatialSource(format) } } });
      expect((await provider.getItem?.('m-arrival'))?.versions?.[0]?.audio[0]?.spatial).toBe(expected);
    }
  });

  it('separates an embedded subtitle from a sidecar one', async () => {
    const { provider } = await connect({ routes: { 'GET /Items/m-arrival': { status: 200, json: fixtures.movieDetail } } });
    const subtitles = (await provider.getItem?.('m-arrival'))?.versions?.[0]?.subtitles ?? [];
    expect(subtitles[0]).toMatchObject({ format: 'pgssub', language: 'en', delivery: 'embedded' });
    expect(subtitles[1]).toMatchObject({ format: 'subrip', language: 'de', forced: true, delivery: 'external' });
  });

  it('says nothing rather than nothing-at-all when the server reports no files', async () => {
    const { provider } = await connect({
      routes: { 'GET /Items/m-arrival': { status: 200, json: { ...fixtures.movieDetail, MediaSources: [] } } },
    });
    // Absent, not an empty list: "the server did not say" is not "there are none".
    expect((await provider.getItem?.('m-arrival'))?.versions).toBeUndefined();
  });

  it('offers the file it has, and the smaller ones it would make', async () => {
    const { provider } = await connect({ routes: { 'GET /Items/m-arrival': { status: 200, json: fixtures.movieDetail } } });
    const list = provider.listDownloadOptions;
    if (!list) throw new Error('listDownloadOptions is missing');
    const options = await list({ connectionId: connectionId('connection-1'), externalId: 'm-arrival' });

    const original = options[0];
    expect(original).toMatchObject({ height: 2160, estimatedBytes: 68_719_476_736, transcoded: false, container: 'mkv' });

    // The whole point: 68 GB becomes something that fits on a phone. 1080p at
    // 8 Mbps over a 1h58 film is about 7 GB; 480p about 1.3 GB.
    const smaller = options.filter((option) => option.transcoded);
    expect(smaller.map((option) => option.height)).toEqual([1080, 720, 480, 360]);
    expect(smaller[0]?.estimatedBytes).toBe(Math.round((8_000_000 / 8) * 7098));
    expect(smaller.every((option) => option.container === 'mp4' && option.videoCodec === 'h264')).toBe(true);

    // Nothing taller than the file itself: upscaling costs space and gains
    // nothing, so 4K is not offered as a transcode of a 4K file.
    expect(smaller.some((option) => (option.height ?? 0) >= 2160)).toBe(false);
  });

  it('asks for one file, never a playlist, and hands back a static address', async () => {
    const { provider, http } = await connect({
      routes: {
        'GET /Items/m-arrival': { status: 200, json: fixtures.movieDetail },
        'POST /Items/m-arrival/PlaybackInfo': { status: 200, json: fixtures.directPlayInfo },
      },
    });
    const get = provider.getDownloadDescriptor;
    if (!get) throw new Error('getDownloadDescriptor is missing');
    const plan = await get({ key: { connectionId: connectionId('connection-1'), externalId: 'm-arrival' } });

    const body = JSON.parse(http.to('POST /Items/m-arrival/PlaybackInfo')[0]?.body ?? '{}') as {
      DeviceProfile: { TranscodingProfiles: { Protocol: string; Context: string }[] };
    };
    // http and Static, never hls: a download is one file, not a playlist and
    // a folder of segments.
    expect(body.DeviceProfile.TranscodingProfiles[0]).toMatchObject({ Protocol: 'http', Context: 'Static' });
    expect(plan.transcoded).toBe(false);
    expect(plan.uri).toContain('/Download');
    expect(plan.container).toBe('mp4');
  });

  it('asks the server to make a smaller one when a rung was chosen', async () => {
    const { provider, http } = await connect({
      routes: {
        'GET /Items/m-arrival': { status: 200, json: fixtures.movieDetail },
        'POST /Items/m-arrival/PlaybackInfo': { status: 200, json: fixtures.transcodeInfo },
      },
    });
    const get = provider.getDownloadDescriptor;
    if (!get) throw new Error('getDownloadDescriptor is missing');
    const plan = await get({ key: { connectionId: connectionId('connection-1'), externalId: 'm-arrival' }, optionId: 'source-4k|1080' });

    const body = JSON.parse(http.to('POST /Items/m-arrival/PlaybackInfo')[0]?.body ?? '{}') as {
      MaxStreamingBitrate: number;
      MediaSourceId: string;
      DeviceProfile: { CodecProfiles: { Conditions: { Property: string; Value: string }[] }[] };
    };
    expect(body.MediaSourceId).toBe('source-4k');
    expect(body.MaxStreamingBitrate).toBe(8_000_000);
    const conditions = body.DeviceProfile.CodecProfiles[0]?.Conditions ?? [];
    expect(conditions).toContainEqual(expect.objectContaining({ Property: 'Height', Value: '1080' }));
    // HDR off for a rung: tone-mapping is a transcode either way, and an SDR
    // copy is what a phone shows.
    expect(conditions).toContainEqual(expect.objectContaining({ Property: 'VideoRangeType', Value: 'SDR' }));
    expect(plan.transcoded).toBe(true);
    // A transcode's size is nobody's to know in advance.
    expect(plan.expectedBytes).toBeUndefined();
  });

  it('turns a missing item into NOT_FOUND', async () => {
    const { provider } = await connect({ routes: { 'GET /Items/gone': { status: 404 } } });
    await expect(provider.getItem?.('gone')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('Jellyfin — continue watching', () => {
  it('asks for films and episodes in progress', async () => {
    const { provider, http } = await connect({
      routes: { 'GET /UserItems/Resume': { status: 200, json: fixtures.page([fixtures.episode, fixtures.movie]) } },
    });
    const items = await provider.getResume?.(10);
    expect(items?.map((item) => item.key.externalId)).toEqual(['ep-1', 'm-arrival']);
    expect(http.to('GET /UserItems/Resume')[0]?.query).toMatchObject({
      limit: '10',
      mediaTypes: 'Video',
      includeItemTypes: 'Movie,Episode',
    });
  });

  it('merges chosen libraries by when they were last played', async () => {
    const { provider } = await connect({
      routes: {
        'GET /UserViews': { status: 200, json: fixtures.views },
        'GET /UserItems/Resume': (request) => ({
          status: 200,
          json: fixtures.page(request.query.parentId === 'lib-movies' ? [fixtures.movie] : [fixtures.episode]),
        }),
      },
      settings: { libraries: { mode: 'only', ids: ['lib-movies', 'lib-shows'] } },
    });
    const items = await provider.getResume?.(10);
    // The episode was played on the 25th, the film on the 20th.
    expect(items?.map((item) => item.key.externalId)).toEqual(['ep-1', 'm-arrival']);
  });
});

describe('Jellyfin — artwork', () => {
  it('builds image addresses without a sign-in, in a few fixed widths', async () => {
    const { provider } = await connect({ routes: {} });
    const source = provider.resolveImage?.(imageRef('i/m-arrival/Backdrop/0/backdrop-tag'), { width: 700 });
    expect(source).toEqual({
      uri: `${SERVER}/Items/m-arrival/Images/Backdrop/0?tag=backdrop-tag&fillWidth=960&quality=90`,
    });
    expect(bucket(100)).toBe(160);
    expect(bucket(5000)).toBe(1920);
    expect(provider.resolveImage?.(imageRef('nonsense'), { width: 100 })).toBeNull();
  });

  it('passes a blurhash through', async () => {
    const { provider } = await connect({ routes: {} });
    const source = provider.resolveImage?.(
      imageRef(`i/m/Primary/-/tag/${encodeURIComponent('LEHV6nWB2yk8pyo0adR*.7kCMdnj')}`),
      { width: 200 },
    );
    expect(source?.blurhash).toBe('LEHV6nWB2yk8pyo0adR*.7kCMdnj');
  });

  it('hands out the authorization header only once signed in', async () => {
    const { provider } = await connect({ routes: { 'GET /UserViews': { status: 200, json: fixtures.views } } });
    await expect(provider.resolveHeaders?.(headersRef('auth'))).resolves.toBeUndefined();
    await provider.getLibraries?.();
    const headers = await provider.resolveHeaders?.(headersRef('auth'));
    expect(headers?.Authorization).toContain('Token="token-1"');
  });
});

describe('Jellyfin — playing', () => {
  const key = { connectionId: connectionId('connection-1'), externalId: 'm-arrival' };
  // Rough shapes of two engines: a phone's, which plays HDR and MP4 files, and a browser's.
  const phone: PlayerProfile = {
    protocols: ['progressive', 'hls'],
    containers: ['mp4', 'm4v', 'mov'],
    videoCodecs: ['h264', 'hevc'],
    audioCodecs: ['aac', 'ac3', 'eac3'],
    subtitleFormats: ['vtt'],
    hdr: ['hdr10', 'dolby-vision'],
    maxHeight: 2160,
  };
  const browser: PlayerProfile = { protocols: ['progressive', 'hls'], containers: ['mp4', 'm4v', 'webm'], videoCodecs: ['h264', 'vp9'], audioCodecs: ['aac', 'opus'], subtitleFormats: ['vtt'] };
  const playbackRoute = (json: unknown): Readonly<Record<string, Route>> => ({ 'POST /Items/m-arrival/PlaybackInfo': { status: 200, json } });

  async function describePlayback(json: unknown, request: Partial<PlaybackRequest> = {}, options: { network?: NetworkKind; fields?: FieldValues } = {}) {
    const connected = await connect({ routes: { ...playbackRoute(json), ...REPORTS }, ...options });
    const getPlaybackDescriptor = connected.provider.getPlaybackDescriptor;
    if (!getPlaybackDescriptor) throw new Error('getPlaybackDescriptor is missing');
    const descriptor = await getPlaybackDescriptor({ key, profile: phone, ...request });
    const [asked] = connected.http.to('POST /Items/m-arrival/PlaybackInfo');
    return { ...connected, descriptor, asked, body: JSON.parse(asked?.body ?? '{}') as Record<string, unknown> };
  }
  const REPORTS: Readonly<Record<string, Route>> = {
    'POST /Sessions/Playing': { status: 204 },
    'POST /Sessions/Playing/Progress': { status: 204 },
    'POST /Sessions/Playing/Stopped': { status: 204 },
    'POST /UserPlayedItems/m-arrival': { status: 200, json: { Played: true } },
    'DELETE /UserPlayedItems/m-arrival': { status: 200, json: { Played: false } },
  };

  it('carries the file’s chapters and the segments worth skipping, and plays without either', async () => {
    // The shapes a real Jellyfin 12 answers with: ticks, and the server's own
    // names for the segment types.
    const marks: Readonly<Record<string, Route>> = {
      'GET /Items/m-arrival': {
        status: 200,
        json: {
          Id: 'm-arrival',
          Chapters: [
            { Name: 'Chapter 02', StartPositionTicks: 1_229_980_000 },
            { Name: 'Chapter 01', StartPositionTicks: 0 },
            // No start is not a mark.
            { Name: 'Broken' },
          ],
        },
      },
      'GET /MediaSegments/m-arrival': {
        status: 200,
        json: {
          Items: [
            { Id: 's2', ItemId: 'm-arrival', Type: 'Outro', StartTicks: 14_349_750_000, EndTicks: 15_409_559_999 },
            { Id: 's1', ItemId: 'm-arrival', Type: 'Intro', StartTicks: 1_229_980_000, EndTicks: 2_150_060_000 },
            // A type this app does not know, and one that ends before it starts.
            { Id: 's3', ItemId: 'm-arrival', Type: 'Sponsor', StartTicks: 1, EndTicks: 2 },
            { Id: 's4', ItemId: 'm-arrival', Type: 'Recap', StartTicks: 500, EndTicks: 400 },
          ],
          TotalRecordCount: 4,
        },
      },
    };
    const connected = await connect({ routes: { ...playbackRoute(fixtures.directPlayInfo), ...REPORTS, ...marks } });
    const descriptor = await connected.provider.getPlaybackDescriptor?.({ key, profile: phone });
    // Both in order of where they begin, whatever order the server sent them in.
    expect(descriptor?.chapters).toEqual([{ startMs: 0, title: 'Chapter 01' }, { startMs: 122_998, title: 'Chapter 02' }]);
    expect(descriptor?.segments).toEqual([
      { kind: 'intro', startMs: 122_998, endMs: 215_006 },
      { kind: 'outro', startMs: 1_434_975, endMs: 1_540_956 },
    ]);

    // A server with neither endpoint still plays: the marks are never fatal.
    const bare = await describePlayback(fixtures.directPlayInfo);
    expect(bare.descriptor.sources.length).toBe(1);
    expect(bare.descriptor.chapters).toBeUndefined();
    expect(bare.descriptor.segments).toBeUndefined();
  });

  it('asks for a stream with the player’s profile as a DeviceProfile', async () => {
    const { asked, body } = await describePlayback(fixtures.directPlayInfo, { startMs: 90_000, audioTrackId: '2', subtitleTrackId: '3' });
    expect(asked?.query).toEqual({ userId: 'user-1' });
    expect(body).toMatchObject({ UserId: 'user-1', StartTimeTicks: 900_000_000, AudioStreamIndex: 2, SubtitleStreamIndex: 3, MaxStreamingBitrate: 120_000_000, EnableTranscoding: true });
    const profile = body.DeviceProfile as Record<string, unknown>;
    expect(profile.DirectPlayProfiles).toEqual(
      ['mp4', 'm4v', 'mov'].map((container) => ({ Container: container, Type: 'Video', VideoCodec: 'h264,hevc', AudioCodec: 'aac,ac3,eac3' })),
    );
    expect(profile.TranscodingProfiles).toEqual([
      expect.objectContaining({ Container: 'ts', VideoCodec: 'h264', AudioCodec: 'aac', Protocol: 'hls', Context: 'Streaming' }),
    ]);
    expect(profile.CodecProfiles).toEqual([
      {
        Type: 'Video',
        Conditions: [
          expect.objectContaining({ Condition: 'EqualsAny', Property: 'VideoRangeType', Value: expect.stringMatching(/^SDR\|DOVIWithSDR\|HDR10\|.*DOVI\b/) }),
          { Condition: 'LessThanEqual', Property: 'Height', Value: '2160', IsRequired: false },
        ],
      },
    ]);
    expect(profile.SubtitleProfiles).toEqual([
      { Format: 'vtt', Method: 'Embed' },
      { Format: 'webvtt', Method: 'Embed' },
      { Format: 'vtt', Method: 'Hls' },
    ]);
  });

  it('asks for a modest stream on mobile data', async () => {
    const { body } = await describePlayback(fixtures.directPlayInfo, {}, { network: 'cellular', fields: { localOnly: false } });
    expect(body.MaxStreamingBitrate).toBe(8_000_000);
  });

  it('plays a file as it is: its own address with the token, named as the player names it', async () => {
    const { descriptor } = await describePlayback(fixtures.directPlayInfo, { profile: browser });
    expect(descriptor.sources).toEqual([
      {
        uri: `${SERVER}/Videos/m-arrival/stream.mp4?static=true&mediaSourceId=ms-arrival&playSessionId=play-1&Tag=etag-1&api_key=token-1`,
        protocol: 'progressive',
        container: 'mp4',
        videoCodec: 'h264',
        audioCodecs: ['aac', 'ac3'],
        height: 1080,
        transcoded: false,
        live: false,
      },
    ]);
    expect(descriptor.durationMs).toBe(6_960_000);
    expect(descriptor.audioTracks).toEqual([
      { id: '1', label: 'English - AAC - Stereo - Default', language: 'en', codec: 'aac', channels: 2, default: true },
      { id: '2', label: 'German - Dolby Digital - 5.1', language: 'de', codec: 'ac3', channels: 6 },
    ]);
    expect(descriptor.subtitleTracks).toEqual([{ id: '3', label: 'English - MOV_TEXT', language: 'en', format: 'mov_text', delivery: 'embedded' }]);
    // The browser plays what the server chose for it.
    expect(canPlay(browser, descriptor.sources[0] as PlaybackSource)).toBe(true);
  });

  it('plays a transcode from the server’s own address, and says how each subtitle arrives', async () => {
    const { descriptor } = await describePlayback(fixtures.transcodeInfo, { startMs: 60_000 });
    expect(descriptor.sources).toEqual([
      {
        uri: `${SERVER}/videos/m-arrival/master.m3u8?DeviceId=device&MediaSourceId=ms-arrival&VideoCodec=h264&AudioCodec=aac&AudioStreamIndex=1&SubtitleStreamIndex=2&SegmentContainer=ts&PlaySessionId=play-2&ApiKey=token-1&SubtitleMethod=Hls`,
        protocol: 'hls',
        videoCodec: 'h264',
        audioCodecs: ['aac'],
        transcoded: true,
        live: false,
      },
    ]);
    expect(descriptor.startMs).toBe(60_000);
    expect(descriptor.subtitleTracks).toEqual([
      { id: '2', label: 'Forced - Turkish - Default - SUBRIP', language: 'tr', format: 'srt', delivery: 'embedded', forced: true, default: true },
      { id: '3', label: 'English - PGSSUB', language: 'en', format: 'pgs', delivery: 'burned' },
      {
        id: '4',
        label: 'French - WEBVTT',
        language: 'fr',
        format: 'vtt',
        delivery: 'external',
        uri: `${SERVER}/Videos/m-arrival/ms-arrival/Subtitles/4/0/Stream.vtt?api_key=token-1`,
      },
    ]);
  });

  it('says plainly when the server has no stream for this player', async () => {
    const connected = await connect({ routes: playbackRoute(fixtures.noStreamInfo) });
    await expect(connected.provider.getPlaybackDescriptor?.({ key, profile: phone })).rejects.toMatchObject({ code: 'INVALID_STATE', retry: 'never' });
  });

  it('reports start, progress and stop with the play session its descriptor began', async () => {
    const { provider, http } = await describePlayback(fixtures.transcodeInfo);
    await provider.reportPlayback?.({ kind: 'started', key, positionMs: 0 });
    await provider.reportPlayback?.({ kind: 'progress', key, positionMs: 12_345, paused: true });
    await provider.reportPlayback?.({ kind: 'stopped', key, positionMs: 60_000 });
    const body = (route: string) => JSON.parse(http.to(route)[0]?.body ?? '{}') as Record<string, unknown>;
    const session = { ItemId: 'm-arrival', MediaSourceId: 'ms-arrival', PlaySessionId: 'play-2', AudioStreamIndex: 1, SubtitleStreamIndex: 2 };
    expect(body('POST /Sessions/Playing')).toEqual({ ...session, PositionTicks: 0, PlayMethod: 'Transcode', CanSeek: true, IsPaused: false });
    expect(body('POST /Sessions/Playing/Progress')).toEqual({ ...session, PositionTicks: 123_450_000, PlayMethod: 'Transcode', CanSeek: true, IsPaused: true, EventName: 'Pause' });
    expect(body('POST /Sessions/Playing/Stopped')).toEqual({ ...session, PositionTicks: 600_000_000 });
  });

  it('reports with the item alone after a restart — safe to deliver twice', async () => {
    const { provider, http } = await connect({ routes: REPORTS });
    await provider.reportPlayback?.({ kind: 'stopped', key, positionMs: 30_000 });
    await provider.reportPlayback?.({ kind: 'stopped', key, positionMs: 30_000 });
    const stops = http.to('POST /Sessions/Playing/Stopped').map((request) => JSON.parse(request.body ?? '{}') as unknown);
    expect(stops).toEqual([
      { ItemId: 'm-arrival', PositionTicks: 300_000_000 },
      { ItemId: 'm-arrival', PositionTicks: 300_000_000 },
    ]);
  });

  it('marks an item watched, and not', async () => {
    const { provider, http } = await connect({ routes: REPORTS });
    await provider.setPlayed?.(key, true);
    await provider.setPlayed?.(key, false);
    expect(http.to('POST /UserPlayedItems/m-arrival')[0]?.query).toEqual({ userId: 'user-1' });
    expect(http.to('DELETE /UserPlayedItems/m-arrival')[0]?.query).toEqual({ userId: 'user-1' });
  });

  it('signs in once more when a report finds the session ended, then never again', async () => {
    let calls = 0;
    const { provider, http } = await connect({
      routes: {
        'POST /Sessions/Playing/Progress': () => {
          calls += 1;
          return { status: calls === 1 ? 401 : 204 };
        },
      },
    });
    await provider.reportPlayback?.({ kind: 'progress', key, positionMs: 1_000, paused: false });
    expect(http.to('POST /Users/AuthenticateByName')).toHaveLength(2);
    expect(calls).toBe(2);
  });
});
