import { connectionId, type CancelSignal, type ConnectedMediaProvider, type FieldValues, type MediaContext } from '@sc/api';
import { plugin } from '@sc/iptv-stalker';
import { describe, expect, it } from 'vitest';

import { endpointsFor } from '../iptv/stalker/src/portal';
import { fakeContext, fakeHttp, target, type RecordedRequest, type Reply } from './support/fake-http';

const MAC = '00:1A:79:12:34:56';
const LOAD = 'GET /stalker_portal/server/load.php';
const key = (externalId: string, connection = 'connection-1') => ({ connectionId: connectionId(connection), externalId });

// Payloads in the shape a Ministra portal sends, trimmed to what is read.
const genres = { js: [{ id: '*', title: 'All' }, { id: '10', title: 'News' }, { id: '11', title: 'Sports' }] };
const channelPage = (page: number) => ({
  js: {
    total_items: 3,
    max_page_items: 2,
    cur_page: page,
    data:
      page === 1
        ? [
            { id: '101', name: 'Morning Wire', number: '1', cmd: 'ffmpeg http://localhost/ch/101_', tv_genre_id: '10', logo: '/stalker_portal/misc/logos/320/101.png', archive: 1, tv_archive_duration: 168 },
            { id: '102', name: 'Stadium One', number: '2', cmd: 'ffrt http://localhost/ch/102_', tv_genre_id: '11', logo: 'http://cdn.test/102.png', archive: 0 },
          ]
        : [{ id: '103', name: 'Late Show', number: '3', cmd: 'ffmpeg http://localhost/ch/103_', tv_genre_id: '10' }],
  },
});
const vodPage = {
  js: {
    total_items: 3,
    max_page_items: 14,
    cur_page: 1,
    data: [
      { id: '501', name: 'Harbor Lights', o_name: 'Harbor Lights', description: 'A film.', year: '2019', time: '112', genres_str: 'Drama, Thriller', rating_imdb: '7.4', screenshot_uri: 'http://cdn.test/501.jpg', cmd: 'L21lZGlhLzUwMS5tcGc=', is_series: '0' },
      { id: '601', name: 'The Relay', year: '2021', is_series: '1', cmd: 'L21lZGlhLzYwMS5tcGc=' },
      { id: '701', name: 'Old Show', year: '2009', is_series: 1, series: [1, 2, 3], cmd: 'L21lZGlhLzcwMS5tcGc=' },
    ],
  },
};
const seasons = { js: { total_items: 2, max_page_items: 14, data: [{ id: '61', name: 'Season 1', season_number: '1' }, { id: '62', name: 'Season 2', season_number: '2' }] } };
// A portal that keeps its series apart, with ids of its own that hold a colon
// and a season that lists its episodes by number.
const seriesCategories = { js: [{ id: '*', title: 'All' }, { id: '270', title: 'Drama' }] };
const seriesPage = {
  js: {
    total_items: 1,
    max_page_items: 14,
    cur_page: 1,
    data: [{ id: '18390:18390', name: 'Harbour Nights', year: '2026', screenshot_uri: 'http://cdn.test/18390.jpg' }],
  },
};
const seriesSeasons = { js: { total_items: 1, max_page_items: 14, data: [{ id: '18390:1', name: 'Season 1', series: [1, 2, 3], cmd: 'L3Nlcmllcy8xODM5MC5ta3Y=' }] } };
const episodes = { js: { total_items: 2, max_page_items: 14, data: [{ id: '611', name: 'Pilot', series_number: '1', cmd: 'L3Nlcmllcy82MTEubWt2' }, { id: '612', name: 'Second', series_number: '2', cmd: 'L3Nlcmllcy82MTIubWt2' }] } };
const now = 1_000_000; // the fake clock's, in ms
const epg = (channel: string, start: number) => ({ ch_id: channel, name: `Show at ${start}`, descr: 'About it.', start_timestamp: start, stop_timestamp: start + 1800 });

interface PortalOptions {
  readonly profile?: Readonly<Record<string, unknown>>;
  readonly expireOnce?: boolean;
  readonly expireAlways?: boolean;
  readonly link?: (request: RecordedRequest) => Reply;
  /** A portal that keeps its series apart from its films, as newer ones do. */
  readonly seriesSection?: boolean;
  /** How many times its series categories fail, as a busy portal's do, before they answer. */
  readonly failCategories?: number;
  /** How many calls find the session ended — the same MAC address signing in elsewhere — whatever the token. */
  readonly stolen?: number;
  /** Its films' pages, where a test needs pages of its own. */
  readonly vod?: (page: number) => unknown;
}

/** A Ministra portal at /stalker_portal/, answering by `type` and `action`. */
function fakePortal(options: PortalOptions = {}) {
  let handshakes = 0;
  let expired = false;
  let categoriesFailed = 0;
  let stolen = 0;
  return {
    handshakes: () => handshakes,
    route: (request: RecordedRequest): Reply => {
      const { type, action } = request.query;
      if (type === 'stb' && action === 'handshake') {
        handshakes += 1;
        return { status: 200, json: { js: { token: `token-${handshakes}` } } };
      }
      if (request.headers.Authorization !== `Bearer token-${handshakes}`) return { status: 200, text: 'Authorization failed.' };
      if (type !== 'stb' && stolen < (options.stolen ?? 0)) {
        stolen += 1;
        return { status: 200, text: 'Authorization failed.' };
      }
      if (options.expireAlways || (options.expireOnce && !expired && type !== 'stb')) {
        expired = true;
        return { status: 200, text: 'Authorization failed.' };
      }
      if (type === 'stb' && action === 'get_profile') return { status: 200, json: { js: { id: '9', name: 'box', status: 0, ...options.profile } } };
      if (type === 'itv' && action === 'get_genres') return { status: 200, json: genres };
      if (type === 'itv' && action === 'get_ordered_list') return { status: 200, json: channelPage(Number(request.query.p)) };
      if (type === 'itv' && action === 'get_all_channels') return { status: 200, json: { js: { total_items: 3, data: [...channelPage(1).js.data, ...channelPage(2).js.data] } } };
      if (type === 'itv' && action === 'get_short_epg') {
        const start = now / 1000 - 600;
        return { status: 200, json: { js: [epg(request.query.ch_id ?? '', start), epg(request.query.ch_id ?? '', start + 1800)] } };
      }
      if (type === 'itv' && action === 'get_epg_info') {
        const start = now / 1000;
        return { status: 200, json: { js: { data: { '101': [epg('101', start), epg('101', start + 7200)], '102': [epg('102', start)] } } } };
      }
      if (action === 'create_link') return options.link?.(request) ?? { status: 200, json: { js: { id: '1', cmd: 'ffmpeg http://stream.test/live/abc123/101.ts?play_token=t0k3n', error: '' } } };
      if (type === 'series') {
        if (!options.seriesSection) return { status: 404 };
        if (action === 'get_categories') {
          if (categoriesFailed < (options.failCategories ?? 0)) {
            categoriesFailed += 1;
            return { status: 503 };
          }
          return { status: 200, json: seriesCategories };
        }
        if (action === 'get_ordered_list') {
          if (request.query.movie_id === '18390:18390') return { status: 200, json: seriesSeasons };
          return { status: 200, json: seriesPage };
        }
      }
      if (type === 'vod' && action === 'get_ordered_list') {
        if (request.query.movie_id === '601') return { status: 200, json: request.query.season_id === '0' ? seasons : episodes };
        if (request.query.movie_id === '701') return { status: 200, json: { js: { total_items: 0, data: [] } } };
        if (options.vod) return { status: 200, json: options.vod(Number(request.query.p)) };
        return { status: 200, json: vodPage };
      }
      return { status: 404 };
    },
  };
}

async function connect(options: PortalOptions & { fields?: FieldValues; credentials?: Record<string, string> } = {}) {
  const portal = fakePortal(options);
  const http = fakeHttp({ [LOAD]: portal.route });
  const fake = fakeContext({ http: http.client, credentials: options.credentials ?? { mac: MAC } });
  const media = plugin.media;
  if (!media) throw new Error('Stalker has no media role.');
  const provider = await media.connect(target({ portalUrl: 'http://portal.test/c/', ...options.fields }), fake.context);
  return { provider, http, fake, portal };
}

/** A session saved by an earlier run, read back a moment later, as a keychain answers. */
async function connectWithSession(saved: { readonly endpoint: string; readonly token: string }, options: PortalOptions = {}) {
  const portal = fakePortal(options);
  const http = fakeHttp({ [LOAD]: portal.route });
  const fake = fakeContext({ http: http.client, credentials: { mac: MAC }, session: JSON.stringify(saved) });
  const context: MediaContext = {
    ...fake.context,
    session: {
      ...fake.context.session,
      read: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return fake.context.session.read();
      },
    },
  };
  const media = plugin.media;
  if (!media) throw new Error('Stalker has no media role.');
  const provider = await media.connect(target({ portalUrl: 'http://portal.test/c/' }), context);
  return { provider, http, fake, portal };
}

/** A signal a test can abort, shaped as the contract's. */
function cancellable() {
  const listeners = new Set<() => void>();
  let aborted = false;
  const signal: CancelSignal = {
    get aborted() {
      return aborted;
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  return {
    signal,
    abort: () => {
      aborted = true;
      for (const listener of listeners) listener();
    },
  };
}

const ENDPOINT = 'http://portal.test/stalker_portal/server/load.php';

function need<K extends keyof ConnectedMediaProvider>(provider: ConnectedMediaProvider, member: K): NonNullable<ConnectedMediaProvider[K]> {
  const found = provider[member];
  if (found === undefined) throw new Error(`${member} is missing`);
  return found as NonNullable<ConnectedMediaProvider[K]>;
}

describe('Stalker — finding the portal and signing in', () => {
  it('knows where a portal’s API may be, for the addresses providers hand out', () => {
    expect(endpointsFor('portal.test/c/')).toEqual(['http://portal.test/server/load.php', 'http://portal.test/stalker_portal/server/load.php', 'http://portal.test/portal.php']);
    expect(endpointsFor('http://portal.test:8080/stalker_portal/c/')).toEqual(['http://portal.test:8080/stalker_portal/server/load.php', 'http://portal.test:8080/stalker_portal/portal.php']);
    expect(endpointsFor('http://portal.test/portal.php?x=1')).toEqual(['http://portal.test/portal.php']);
  });

  it('finds the portal, shakes hands as a MAG box, and reads the profile with the token', async () => {
    const { provider, http, fake } = await connect({ credentials: { mac: '00-1a-79-12-34-56', serialNumber: 'SN1' } });
    await provider.check();
    const [missed, handshake, profile] = http.requests;
    expect(missed?.path).toBe('/server/load.php');
    expect(handshake?.query).toMatchObject({ type: 'stb', action: 'handshake', token: '', JsHttpRequest: '1-xml' });
    expect(handshake?.headers).toMatchObject({
      Cookie: `mac=${MAC}; stb_lang=en; timezone=UTC`,
      'X-User-Agent': 'Model: MAG250; Link: WiFi',
      Referer: 'http://portal.test/c/',
    });
    expect(handshake?.headers['User-Agent']).toContain('MAG200');
    expect(handshake?.headers.Authorization).toBeUndefined();
    expect(profile?.query).toMatchObject({ action: 'get_profile', sn: 'SN1' });
    expect(profile?.headers.Authorization).toBe('Bearer token-1');
    // The session keeps where the portal is and its token — never a link.
    expect(JSON.parse(fake.session() ?? '{}')).toEqual({ endpoint: 'http://portal.test/stalker_portal/server/load.php', token: 'token-1' });
  });

  it('refuses an address that is no MAC address, asking nothing', async () => {
    const { provider, http } = await connect({ credentials: { mac: 'nonsense' } });
    await expect(provider.check()).rejects.toMatchObject({ code: 'INVALID_STATE', retry: 'never' });
    expect(http.requests).toEqual([]);
  });

  it('remembers a portal that refused the MAC address, and never asks it again', async () => {
    const { provider, http } = await connect({ profile: { status: 1 } });
    await expect(provider.check()).rejects.toMatchObject({ code: 'UNAUTHORIZED', retry: 'never' });
    const asked = http.requests.length;
    await expect(need(provider, 'listChannelGroups')()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(http.requests).toHaveLength(asked);
  });

  it('shakes hands once more when a token runs out — and only once', async () => {
    const renewed = await connect({ expireOnce: true });
    await renewed.provider.check();
    expect(await need(renewed.provider, 'listChannelGroups')()).toHaveLength(2);
    expect(renewed.portal.handshakes()).toBe(2);

    const lost = await connect({ expireAlways: true, profile: {} });
    await expect(need(lost.provider, 'listChannelGroups')()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const handshakes = lost.portal.handshakes();
    await expect(need(lost.provider, 'listChannelGroups')()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(lost.portal.handshakes()).toBe(handshakes);
  });
});

describe('Stalker — calls that start together', () => {
  it('reads the saved session once, and every call uses its token — no handshake to end it', async () => {
    const { provider, portal, http } = await connectWithSession({ endpoint: ENDPOINT, token: 'token-0' });
    const [groups, channels] = await Promise.all([need(provider, 'listChannelGroups')(), need(provider, 'listChannels')({ limit: 50 })]);
    expect(groups).toHaveLength(2);
    expect(channels.channels).toHaveLength(2);
    expect(portal.handshakes()).toBe(0);
    expect(http.to(LOAD).every((request) => request.headers.Authorization === 'Bearer token-0')).toBe(true);
  });

  it('renews a token that ran out once, for every call that found it so', async () => {
    const { provider, portal } = await connectWithSession({ endpoint: ENDPOINT, token: 'token-stale' });
    const [groups, channels, again] = await Promise.all([
      need(provider, 'listChannelGroups')(),
      need(provider, 'listChannels')({ limit: 50 }),
      need(provider, 'listChannelGroups')(),
    ]);
    expect([groups.length, channels.channels.length, again.length]).toEqual([2, 2, 2]);
    expect(portal.handshakes()).toBe(1);
  });

  it('signs in for everyone even when the call that started it is given up', async () => {
    const { provider, portal } = await connect();
    const first = cancellable();
    const leaving = need(provider, 'listChannelGroups')(first.signal);
    const staying = need(provider, 'listChannels')({ limit: 50 });
    first.abort();
    await expect(leaving).rejects.toMatchObject({ name: 'TransportError', kind: 'aborted' });
    expect((await staying).channels).toHaveLength(2);
    expect(portal.handshakes()).toBe(1);
  });

  it('says the session was ended elsewhere, and does not hold it against the next call', async () => {
    const { provider, portal } = await connect({ stolen: 2 });
    await expect(need(provider, 'listChannelGroups')()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retry: 'never' });
    expect(portal.handshakes()).toBe(2);
    // Not latched: the next call signs in again, once, and is answered.
    expect(await need(provider, 'listChannelGroups')()).toHaveLength(2);
    expect(portal.handshakes()).toBe(3);
  });
});

describe('Stalker — live TV', () => {
  it('lists the genres as groups, leaving out "All"', async () => {
    const { provider } = await connect();
    expect(await need(provider, 'listChannelGroups')()).toEqual([
      { id: '10', name: 'News' },
      { id: '11', name: 'Sports' },
    ]);
  });

  it('pages channels as the portal does, with their numbers, logos and catch-up', async () => {
    const { provider, http } = await connect();
    const listChannels = need(provider, 'listChannels');
    const first = await listChannels({ groupId: '10', limit: 50 });
    expect(http.to(LOAD).at(-1)?.query).toMatchObject({ type: 'itv', action: 'get_ordered_list', genre: '10', sortby: 'number', p: '1' });
    expect(first).toMatchObject({ total: 3, nextCursor: '2' });
    expect(first.channels[0]).toEqual({
      key: key('ch:101'),
      name: 'Morning Wire',
      number: 1,
      groupIds: ['10'],
      logo: 'http://portal.test/stalker_portal/misc/logos/320/101.png',
      catchupDays: 7,
    });
    const second = await listChannels({ limit: 50, cursor: first.nextCursor ?? '' });
    expect(second.channels.map((channel) => channel.name)).toEqual(['Late Show']);
    expect(second.nextCursor).toBeUndefined();
    expect(http.to(LOAD).at(-1)?.query.genre).toBe('*');
  });

  it('asks each channel for now and next, and all of them at once for a longer guide', async () => {
    const { provider, http } = await connect();
    const getGuide = need(provider, 'getGuide');
    const at = (ms: number) => new Date(ms).toISOString();
    const nowAndNext = await getGuide({ channels: [key('ch:101'), key('ch:999', 'connection-2')], from: at(now), to: at(now + 3_600_000) });
    expect(http.to(LOAD).filter((request) => request.query.action === 'get_short_epg').map((request) => request.query.ch_id)).toEqual(['101']);
    expect(nowAndNext.map((programme) => [programme.title, programme.startsAt])).toEqual([
      [`Show at ${now / 1000 - 600}`, at(now - 600_000)],
      [`Show at ${now / 1000 + 1200}`, at(now + 1_200_000)],
    ]);
    const day = await getGuide({ channels: [key('ch:101'), key('ch:102')], from: at(now), to: at(now + 24 * 3_600_000) });
    expect(http.to(LOAD).find((request) => request.query.action === 'get_epg_info')?.query.period).toBe('24');
    expect(day).toHaveLength(3);
    expect(day[0]).toEqual({ channel: key('ch:101'), title: `Show at ${now / 1000}`, description: 'About it.', startsAt: at(now), endsAt: at(now + 1_800_000) });
  });

  it('asks the whole portal’s guide once for every list in the same five minutes, and gives it time', async () => {
    const { provider, http, fake } = await connect();
    const getGuide = need(provider, 'getGuide');
    const at = (ms: number) => new Date(ms).toISOString();
    const seven = ['101', '102', '103', '104', '105', '106', '107'].map((id) => key(`ch:${id}`));
    const everyGuide = () => http.to(LOAD).filter((request) => request.query.action === 'get_epg_info');
    await getGuide({ channels: seven, from: at(now), to: at(now + 3_600_000) });
    // Another group's channels, a minute later: the same answer serves.
    fake.advance(60_000);
    const other = await getGuide({ channels: [key('ch:101'), ...seven.slice(2)], from: at(now), to: at(now + 3_600_000) });
    expect(other.map((programme) => programme.channel.externalId)).toContain('ch:101');
    expect(everyGuide()).toHaveLength(1);
    expect(everyGuide()[0]?.timeoutMs).toBe(60_000);
    fake.advance(5 * 60_000);
    await getGuide({ channels: seven, from: at(now), to: at(now + 3_600_000) });
    expect(everyGuide()).toHaveLength(2);
  });

  it('makes a channel’s link when it plays — the MAG hint gone, raw MPEG-TS said as such', async () => {
    const { provider, http } = await connect();
    await need(provider, 'listChannels')({ limit: 50 });
    const descriptor = await need(provider, 'getPlaybackDescriptor')({ key: key('ch:101'), profile: { protocols: ['hls'], containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [] } });
    expect(http.to(LOAD).at(-1)?.query).toMatchObject({ type: 'itv', action: 'create_link', cmd: 'ffmpeg http://localhost/ch/101_' });
    expect(descriptor.sources).toEqual([{ uri: 'http://stream.test/live/abc123/101.ts?play_token=t0k3n', protocol: 'mpegts', container: 'ts', transcoded: false, live: true }]);
  });

  it('plays a channel before its list was read, by reading every channel once', async () => {
    const { provider, http } = await connect({ link: () => ({ status: 200, json: { js: { cmd: 'ffmpeg http://stream.test/live/103/index.m3u8' } } }) });
    const getPlaybackDescriptor = need(provider, 'getPlaybackDescriptor');
    const profile = { protocols: ['hls' as const], containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [] };
    const descriptor = await getPlaybackDescriptor({ key: key('ch:103'), profile });
    expect(descriptor.sources[0]).toMatchObject({ protocol: 'hls', live: true });
    await getPlaybackDescriptor({ key: key('ch:101'), profile });
    const everyChannel = http.to(LOAD).filter((request) => request.query.action === 'get_all_channels');
    expect(everyChannel).toHaveLength(1);
    // Every channel in one answer takes longer than a page.
    expect(everyChannel[0]?.timeoutMs).toBe(60_000);
  });

  it('says so when the subscription is busy on other devices', async () => {
    const { provider } = await connect({ link: () => ({ status: 200, json: { js: { cmd: '', error: 'limit' } } }) });
    await need(provider, 'listChannels')({ limit: 50 });
    await expect(
      need(provider, 'getPlaybackDescriptor')({ key: key('ch:101'), profile: { protocols: ['mpegts'], containers: ['ts'], videoCodecs: [], audioCodecs: [], subtitleFormats: [] } }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff' });
  });
});

describe('Stalker — films and series', () => {
  const profile = { protocols: ['progressive' as const, 'hls' as const, 'mpegts' as const], containers: ['mkv', 'mp4', 'ts'], videoCodecs: [], audioCodecs: [], subtitleFormats: [] };

  it('lists films and series from an older portal’s shared pages, in its order for the sort', async () => {
    const { provider, http } = await connect();
    const listItems = need(provider, 'listItems');
    const movies = await listItems({ kind: 'movies', sort: { by: 'addedAt', order: 'desc' }, limit: 20 });
    expect(http.to(LOAD).at(-1)?.query).toMatchObject({ type: 'vod', action: 'get_ordered_list', category: '*', sortby: 'added', p: '1' });
    expect(movies.items).toEqual([
      {
        type: 'movie',
        key: key('vod:501'),
        title: 'Harbor Lights',
        overview: 'A film.',
        year: 2019,
        runtimeMs: 112 * 60_000,
        ratings: { community: 7.4 },
        genres: ['Drama', 'Thriller'],
        images: { poster: 'http://cdn.test/501.jpg' },
      },
    ]);
    const shows = await listItems({ kind: 'shows', sort: { by: 'title', order: 'asc' }, limit: 20 });
    expect(http.to(LOAD).at(-1)?.query.sortby).toBe('name');
    expect(shows.items.map((item) => item.key.externalId)).toEqual(['show:v:601', 'show:v:701']);
    expect((await need(provider, 'getItem')('vod:501')).item.title).toBe('Harbor Lights');
  });

  it('plays a film through its link', async () => {
    const { provider, http } = await connect({ link: () => ({ status: 200, json: { js: { cmd: 'ffmpeg http://stream.test/vod/501.mkv?token=x' } } }) });
    await need(provider, 'listItems')({ kind: 'movies', sort: { by: 'addedAt', order: 'desc' }, limit: 20 });
    const descriptor = await need(provider, 'getPlaybackDescriptor')({ key: key('vod:501'), profile, startMs: 5_000 });
    expect(http.to(LOAD).at(-1)?.query).toMatchObject({ type: 'vod', action: 'create_link', cmd: 'L21lZGlhLzUwMS5tcGc=' });
    expect(descriptor).toMatchObject({ sources: [{ protocol: 'progressive', container: 'mkv', live: false }], startMs: 5_000 });
  });

  it('lists a series’ seasons and episodes, and plays an episode', async () => {
    const { provider, http } = await connect({ link: () => ({ status: 200, json: { js: { cmd: 'ffmpeg http://stream.test/series/611.mkv' } } }) });
    const listItems = need(provider, 'listItems');
    const getChildren = need(provider, 'getChildren');
    const [show] = (await listItems({ kind: 'shows', sort: { by: 'title', order: 'asc' }, limit: 20 })).items;
    if (!show) throw new Error('no show');
    const { items: found } = await getChildren(show);
    expect(found.map((season) => [season.key.externalId, season.title])).toEqual([
      ['season:v:601:61', 'Season 1'],
      ['season:v:601:62', 'Season 2'],
    ]);
    const [first] = found;
    if (!first) throw new Error('no season');
    const { items: list } = await getChildren(first);
    expect(list.map((episode) => [episode.key.externalId, episode.type === 'episode' ? episode.episodeNumber : undefined])).toEqual([
      ['episode:v:601:61:611', 1],
      ['episode:v:601:61:612', 2],
    ]);
    await need(provider, 'getPlaybackDescriptor')({ key: key('episode:v:601:61:611'), profile });
    expect(http.to(LOAD).at(-1)?.query).toMatchObject({ type: 'vod', action: 'create_link', cmd: 'L3Nlcmllcy82MTEubWt2', series: '1' });
  });

  it('gives an old portal’s numbered episodes one season, played through the series with their number', async () => {
    const { provider, http } = await connect();
    const listItems = need(provider, 'listItems');
    const getChildren = need(provider, 'getChildren');
    const show = (await listItems({ kind: 'shows', sort: { by: 'title', order: 'asc' }, limit: 20 })).items.find((item) => item.key.externalId === 'show:v:701');
    if (!show) throw new Error('no show');
    const [season] = (await getChildren(show)).items;
    if (!season) throw new Error('no season');
    const { items: list } = await getChildren(season);
    expect(list.map((episode) => episode.title)).toEqual(['Episode 1', 'Episode 2', 'Episode 3']);
    await need(provider, 'getPlaybackDescriptor')({ key: key('episode:v:701:1:2'), profile });
    expect(http.to(LOAD).at(-1)?.query).toMatchObject({ action: 'create_link', cmd: 'L21lZGlhLzcwMS5tcGc=', series: '2' });
  });

  it('takes a portal’s own series section, ids with a colon and all, and plays an episode through it', async () => {
    const { provider, http } = await connect({
      seriesSection: true,
      link: () => ({ status: 200, json: { js: { cmd: 'ffmpeg http://stream.test/series/18390.mkv' } } }),
    });
    const listItems = need(provider, 'listItems');
    const getChildren = need(provider, 'getChildren');

    const shows = await listItems({ kind: 'shows', sort: { by: 'title', order: 'asc' }, limit: 20 });
    // Asked for once — the portal's categories say whether it has the section —
    // and then it is the series list that answers, not the films.
    expect(http.to(LOAD).map((request) => `${request.query.type} ${request.query.action}`)).toEqual([
      'stb handshake',
      'stb get_profile',
      'series get_categories',
      'series get_ordered_list',
    ]);
    expect(shows.items.map((item) => [item.key.externalId, item.title])).toEqual([['show:s:18390%3A18390', 'Harbour Nights']]);

    // The films are still the films.
    const movies = await listItems({ kind: 'movies', sort: { by: 'title', order: 'asc' }, limit: 20 });
    expect(http.to(LOAD).at(-1)?.query.type).toBe('vod');
    expect(movies.items.map((item) => item.key.externalId)).toEqual(['vod:501']);

    const [show] = shows.items;
    if (!show) throw new Error('no show');
    const { items: found } = await getChildren(show);
    expect(http.to(LOAD).at(-1)?.query).toMatchObject({ type: 'series', movie_id: '18390:18390', season_id: '0' });
    expect(found.map((season) => [season.key.externalId, season.title])).toEqual([['season:s:18390%3A18390:18390%3A1', 'Season 1']]);

    // This season lists its episodes by number, so they need no call of their own.
    const [season] = found;
    if (!season) throw new Error('no season');
    const before = http.to(LOAD).length;
    const { items: list } = await getChildren(season);
    expect(http.to(LOAD).length).toBe(before);
    expect(list.map((episode) => [episode.key.externalId, episode.title])).toEqual([
      ['episode:s:18390%3A18390:18390%3A1:1', 'Episode 1'],
      ['episode:s:18390%3A18390:18390%3A1:2', 'Episode 2'],
      ['episode:s:18390%3A18390:18390%3A1:3', 'Episode 3'],
    ]);

    // A portal's series section lists; every link is made on the films' side.
    await need(provider, 'getPlaybackDescriptor')({ key: key('episode:s:18390%3A18390:18390%3A1:2'), profile });
    expect(http.to(LOAD).at(-1)?.query).toMatchObject({ type: 'vod', action: 'create_link', cmd: 'L3Nlcmllcy8xODM5MC5ta3Y=', series: '2' });
  });

  it('asks again whether there is a series section after it could not ask, rather than taking that for no', async () => {
    const { provider, http } = await connect({ seriesSection: true, failCategories: 1 });
    const listItems = need(provider, 'listItems');
    const shows = { kind: 'shows', sort: { by: 'title', order: 'asc' }, limit: 20 } as const;
    await expect(listItems(shows)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff' });
    expect((await listItems(shows)).items.map((item) => item.title)).toEqual(['Harbour Nights']);
    // Known now, and not asked a third time.
    await listItems(shows);
    expect(http.to(LOAD).filter((request) => request.query.action === 'get_categories')).toHaveLength(2);
  });

  it('reads on past pages that hold none of the kind asked for, rather than answer them empty', async () => {
    const films = (page: number) => ({ id: `${page}01`, name: `Film ${page}`, is_series: '0' });
    const { provider, http } = await connect({
      vod: (page) => ({ js: { total_items: 20, max_page_items: 2, cur_page: page, data: page === 3 ? [films(page), { id: '901', name: 'A Series', is_series: '1' }] : [films(page)] } }),
    });
    const listItems = need(provider, 'listItems');
    const first = await listItems({ kind: 'shows', sort: { by: 'title', order: 'asc' }, limit: 20 });
    expect(first.items.map((item) => item.title)).toEqual(['A Series']);
    expect(first.nextCursor).toBe('4');
    expect(http.to(LOAD).filter((request) => request.query.type === 'vod').map((request) => request.query.p)).toEqual(['1', '2', '3']);
    // At most three pages at a time: past that, an empty page that says where to go on.
    const next = await listItems({ kind: 'shows', sort: { by: 'title', order: 'asc' }, limit: 20, cursor: '4' });
    expect(next).toEqual({ items: [], nextCursor: '7' });
  });

  it('refuses to play a series as a whole', async () => {
    const { provider } = await connect();
    await expect(need(provider, 'getPlaybackDescriptor')({ key: key('show:v:601'), profile })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('opens a series asked for while its list is still on its way', async () => {
    const { provider } = await connect({ seriesSection: true });
    // A saved page shows at launch; the series is opened before the portal has answered.
    const listing = need(provider, 'listItems')({ kind: 'shows', sort: { by: 'title', order: 'asc' }, limit: 20 });
    const opened = need(provider, 'getItem')('show:s:18390%3A18390');
    await listing;
    expect((await opened).item.title).toBe('Harbour Nights');
  });

  it('still says it does not know a series nothing has listed', async () => {
    const { provider } = await connect({ seriesSection: true });
    await expect(need(provider, 'getItem')('show:s:18390%3A18390')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
