import {
  AppError,
  encodeBase64,
  encodeUtf8,
  type ConnectedMediaProvider,
  type Credentials,
  type FieldValues,
  type ItemPage,
  type PlayerProfile,
  type SearchScope,
} from '@sc/api';
import { plugin } from '@sc/source-yattee';
import { describe, expect, it } from 'vitest';

import { normalizeBaseUrl } from '../sources/yattee/src/url';
import * as fixtures from './fixtures/yattee';
import { fakeContext, fakeHttp, target, type Route } from './support/fake-http';

const SERVER = 'https://yt.test';

const ALIVE: Readonly<Record<string, Route>> = {
  'GET /health': { status: 200, json: fixtures.health },
  'GET /info': { status: 200, json: fixtures.info },
};

async function connect(options: {
  routes?: Readonly<Record<string, Route>>;
  fields?: FieldValues;
  settings?: FieldValues;
  credentials?: Credentials;
}) {
  const http = fakeHttp({ ...ALIVE, ...options.routes });
  const fake = fakeContext({
    http: http.client,
    ...(options.credentials ? { credentials: options.credentials } : {}),
  });
  const media = plugin.media;
  if (!media) throw new Error('The Yattee plugin has no media role.');
  const provider = await media.connect(
    target({ serverUrl: SERVER, username: 'alex', ...options.fields }, options.settings ?? {}),
    fake.context,
  );
  return { provider, http, fake };
}

function listVideos(
  provider: ConnectedMediaProvider,
  options: { term?: string; cursor?: string; scope?: SearchScope } = {},
): Promise<ItemPage> {
  const listItems = provider.listItems;
  if (!listItems) throw new Error('listItems is missing');
  return listItems({
    kind: 'videos',
    sort: { by: 'addedAt', order: 'desc' },
    limit: 2,
    ...(options.term ? { term: options.term } : {}),
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(options.scope ? { scope: options.scope } : {}),
  });
}

const EVERYTHING: PlayerProfile = {
  protocols: ['progressive', 'hls'],
  containers: ['mp4'],
  videoCodecs: ['h264', 'hevc', 'av1'],
  audioCodecs: ['aac', 'opus'],
  subtitleFormats: ['vtt'],
};

describe('Yattee — the address', () => {
  it('reduces a pasted API or admin address to the base', () => {
    expect(normalizeBaseUrl('https://yt.test/api/v1/')).toBe('https://yt.test');
    expect(normalizeBaseUrl('https://yt.test/admin/users')).toBe('https://yt.test');
    expect(normalizeBaseUrl('  https://yt.test:8080/?x=1  ')).toBe('https://yt.test:8080');
    expect(normalizeBaseUrl('https://yt.test')).toBe('https://yt.test');
  });
});

describe('Yattee — signing in', () => {
  it('sends HTTP Basic, built without btoa', async () => {
    const { provider, http } = await connect({ credentials: { password: 'hunter2' } });
    await provider.check();
    const expected = `Basic ${encodeBase64(encodeUtf8('alex:hunter2'))}`;
    expect(http.to('GET /info')[0]?.headers.Authorization).toBe(expected);
  });

  it('proves the address and the credentials in one press', async () => {
    const { provider, http } = await connect({});
    const info = await provider.check();
    expect(info.version).toBe('1.4.2');
    // `/health` is open before setup, so it alone proves nothing about the
    // sign-in; `/info` is the one that does.
    expect(http.to('GET /health')).toHaveLength(1);
    expect(http.to('GET /info')[0]?.headers.Authorization).toBeDefined();
  });

  it('does not send credentials to the open health check', async () => {
    const { provider, http } = await connect({});
    await provider.check();
    expect(http.to('GET /health')[0]?.headers.Authorization).toBeUndefined();
  });

  it('latches a refusal and never asks again', async () => {
    const { provider, http } = await connect({ routes: { 'GET /info': { status: 401 } } });
    await expect(provider.check()).rejects.toMatchObject({ code: 'UNAUTHORIZED', retry: 'never' });
    await expect(provider.check()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(listVideos(provider)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    // One real attempt, however many times it is asked: a server locks an
    // account after a few failures.
    expect(http.to('GET /info')).toHaveLength(1);
  });

  it('maps a rate limit to a backoff that says why', async () => {
    const { provider } = await connect({ routes: { 'GET /info': { status: 429 } } });
    await expect(provider.check()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retry: 'backoff',
      reason: 'too-many-attempts',
    });
  });
});

describe('Yattee — browsing', () => {
  it('shows trending when nothing is searched for', async () => {
    const { provider, http } = await connect({
      routes: { 'GET /api/v1/trending': { status: 200, json: fixtures.trending } },
      settings: { region: 'DE' },
    });
    const page = await listVideos(provider);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.title).toBe('A video with a long enough name to wrap');
    expect(http.to('GET /api/v1/trending')[0]?.query.region).toBe('DE');
    // Trending is one page the server curates; there is no second.
    expect(page.nextCursor).toBeUndefined();
  });

  it('searches, and pages while a page brings something new', async () => {
    const { provider, http } = await connect({
      routes: { 'GET /api/v1/search': { status: 200, json: fixtures.searchResults } },
    });
    const page = await listVideos(provider, { term: 'a found video' });
    expect(page.items.map((item) => item.title)).toEqual(['A found video', 'Another found video']);
    const request = http.to('GET /api/v1/search')[0];
    expect(request?.query.q).toBe('a found video');
    expect(request?.query.type).toBe('video');
    expect(request?.query.sort).toBe('upload_date');
    expect(page.nextCursor).toBe('2');
  });

  it('pages on from a page smaller than asked for, which is the server’s own size', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/search': { status: 200, json: [fixtures.searchResults[0]] } },
    });
    expect((await listVideos(provider, { term: 'one' })).nextCursor).toBe('2');
  });

  it('ends a search at a page that brings nothing new', async () => {
    // A server that answers every page with the same videos.
    const { provider } = await connect({ routes: { 'GET /api/v1/search': { status: 200, json: fixtures.searchResults } } });
    const first = await listVideos(provider, { term: 'again' });
    const second = await listVideos(provider, { term: 'again', cursor: first.nextCursor ?? '' });
    expect(second.items).toEqual([]);
    expect(second.nextCursor).toBeUndefined();
    // A new search starts afresh, and finds them again.
    expect((await listVideos(provider, { term: 'again' })).items).toHaveLength(2);
  });

  it('narrows a search to channels or playlists, and maps each answer as what it is', async () => {
    const { provider, http } = await connect({ routes: { 'GET /api/v1/search': { status: 200, json: fixtures.mixedResults } } });
    const page = await listVideos(provider, { term: 'some', scope: 'all' });
    expect(http.to('GET /api/v1/search')[0]?.query.type).toBe('all');
    expect(page.items.map((item) => [item.type, item.title])).toEqual([
      ['movie', 'A found video'],
      ['channel', 'Some Channel'],
      ['playlist', 'Things worth rewatching'],
    ]);
    const channel = page.items[1];
    expect(channel?.type === 'channel' ? channel.followers : undefined).toBe(1_234_567);
    expect(channel?.key.externalId).toBe('channel:UCuAXFkgsw1L7xaCfnd5JJOw');
    const playlist = page.items[2];
    expect(playlist?.type === 'playlist' ? playlist.owner?.name : undefined).toBe('Some Channel');

    await listVideos(provider, { term: 'some', scope: 'channel' });
    expect(http.to('GET /api/v1/search')[1]?.query.type).toBe('channel');
  });

  it('answers nothing for a kind it does not bring', async () => {
    const { provider, http } = await connect({});
    const listItems = provider.listItems;
    if (!listItems) throw new Error('listItems is missing');
    const page = await listItems({ kind: 'movies', sort: { by: 'title', order: 'asc' }, limit: 10 });
    expect(page.items).toEqual([]);
    // And it does not ask the server for something it cannot answer.
    expect(http.requests.filter((request) => request.path.startsWith('/api/v1/'))).toHaveLength(0);
  });

  it('maps a video to a playable item, the channel as its label', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: fixtures.video } },
    });
    const getItem = provider.getItem;
    if (!getItem) throw new Error('getItem is missing');
    const detail = await getItem('dQw4w9WgXcQ');
    expect(detail.item.type).toBe('movie');
    expect(detail.item.runtimeMs).toBe(213_000);
    expect(detail.item.releaseDate).toBe('2010-10-29');
    expect(detail.item.year).toBe(2010);
    expect(detail.item.genres).toEqual(['Some Channel']);
    expect(detail.externalIds).toEqual({ youtube: 'dQw4w9WgXcQ' });
    // Its channel, so the page leads there.
    expect(detail.creator?.key.externalId).toBe('channel:UCuAXFkgsw1L7xaCfnd5JJOw');
    expect(detail.creator?.name).toBe('Some Channel');
  });

  it('opens a channel and a playlist as things with videos inside', async () => {
    const { provider } = await connect({
      routes: {
        'GET /api/v1/channels/UCuAXFkgsw1L7xaCfnd5JJOw': { status: 200, json: fixtures.channel },
        'GET /api/v1/channels/UCuAXFkgsw1L7xaCfnd5JJOw/videos': { status: 200, json: fixtures.channelVideos },
        'GET /api/v1/playlists/PLabcdefghij': { status: 200, json: fixtures.playlist },
      },
    });
    const getItem = provider.getItem;
    const getChildren = provider.getChildren;
    if (!getItem || !getChildren) throw new Error('browse members are missing');

    const channel = await getItem('channel:UCuAXFkgsw1L7xaCfnd5JJOw');
    expect(channel.item.type).toBe('channel');
    expect(channel.item.title).toBe('Some Channel');
    expect(channel.sections?.map((section) => section.label)).toEqual(['Videos', 'Shorts', 'Live', 'Playlists']);
    const inChannel = await getChildren(channel.item);
    expect(inChannel.items.map((item) => item.title)).toEqual(['The channel’s newest', 'The one before it']);

    const playlist = await getItem('playlist:PLabcdefghij');
    expect(playlist.item.type).toBe('playlist');
    expect(playlist.item.title).toBe('Things worth rewatching');
    const inPlaylist = await getChildren(playlist.item);
    expect(inPlaylist.items).toHaveLength(2);
  });

  it('pages a channel’s section by the token the server hands out', async () => {
    const { provider, http } = await connect({
      routes: {
        'GET /api/v1/channels/UCuAXFkgsw1L7xaCfnd5JJOw': { status: 200, json: fixtures.channel },
        'GET /api/v1/channels/UCuAXFkgsw1L7xaCfnd5JJOw/shorts': { status: 200, json: { ...fixtures.channelVideos, continuation: 'next-token' } },
        'GET /api/v1/channels/UCuAXFkgsw1L7xaCfnd5JJOw/playlists': { status: 200, json: fixtures.channelPlaylists },
      },
    });
    const getItem = provider.getItem;
    const getChildren = provider.getChildren;
    if (!getItem || !getChildren) throw new Error('browse members are missing');
    const channel = (await getItem('channel:UCuAXFkgsw1L7xaCfnd5JJOw')).item;

    const shorts = await getChildren(channel, undefined, { section: 'shorts' });
    expect(shorts.nextCursor).toBe('next-token');
    await getChildren(channel, undefined, { section: 'shorts', cursor: 'next-token' });
    expect(http.to('GET /api/v1/channels/UCuAXFkgsw1L7xaCfnd5JJOw/shorts')[1]?.query.continuation).toBe('next-token');

    const playlists = await getChildren(channel, undefined, { section: 'playlists' });
    expect(playlists.items.map((item) => [item.type, item.title])).toEqual([['playlist', 'Things worth rewatching']]);
    // No token, no next page.
    expect(playlists.nextCursor).toBeUndefined();
  });
});

describe('Yattee — what the file is', () => {
  it('lists the renditions as versions, tallest first and one per height', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: fixtures.video } },
    });
    const getItem = provider.getItem;
    if (!getItem) throw new Error('getItem is missing');
    const versions = (await getItem('dQw4w9WgXcQ'))?.versions ?? [];
    // 1080p comes from adaptiveFormats: it cannot be played as it stands, but
    // it is what the site holds, and a download can ask for it.
    expect(versions.map((version) => version.video?.height)).toEqual([1080, 720, 360]);
    expect(versions[0]).toMatchObject({
      label: '1080p',
      container: 'mp4',
      sizeBytes: 112_328_704,
      bitrate: 4_200_000,
      durationMs: 213_000,
    });
    expect(versions[0]?.video).toMatchObject({ codec: 'h264', frameRate: 30 });
    // The audio-only rendition has no height and is not a version of the video.
    expect(versions).toHaveLength(3);
  });

  it('carries the captions onto every version', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: fixtures.video } },
    });
    const getItem = provider.getItem;
    if (!getItem) throw new Error('getItem is missing');
    const version = (await getItem('dQw4w9WgXcQ'))?.versions?.[0];
    expect(version?.subtitles.map((track) => track.language)).toEqual(['en', 'de']);
    expect(version?.subtitles[0]?.delivery).toBe('external');
  });
});

describe('Yattee — artwork', () => {
  // A server that proxies pictures signs each address it hands out, for that
  // video and a day, and checks no Basic sign-in on them.
  const proxied = {
    ...fixtures.video,
    videoThumbnails: [
      { quality: 'maxres', url: '/api/v1/thumbnails/dQw4w9WgXcQ/maxres.jpg?token=signed', width: 1280, height: 720 },
      { quality: 'medium', url: '/api/v1/thumbnails/dQw4w9WgXcQ/medium.jpg?token=signed', width: 320, height: 180 },
    ],
  };

  it('draws a thumbnail from the address the server signed for it, the size asked for', async () => {
    const { provider } = await connect({ routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: proxied } } });
    const getItem = provider.getItem;
    const resolveImage = provider.resolveImage;
    if (!getItem || !resolveImage) throw new Error('image members are missing');
    const ref = (await getItem('dQw4w9WgXcQ')).item.images.thumb;
    if (!ref) throw new Error('no thumbnail');
    // The ref names the video and nothing that expires.
    expect(String(ref)).toBe('v/dQw4w9WgXcQ');
    expect(resolveImage(ref, { width: 320 })?.uri).toBe('https://yt.test/api/v1/thumbnails/dQw4w9WgXcQ/medium.jpg?token=signed');
    expect(resolveImage(ref, { width: 1000 })?.uri).toBe('https://yt.test/api/v1/thumbnails/dQw4w9WgXcQ/maxres.jpg?token=signed');
    // Larger than any there is: the largest.
    expect(resolveImage(ref, { width: 4000 })?.uri).toContain('/maxres.jpg');
    // The server's own address may take its sign-in, by ref — never inline.
    expect(resolveImage(ref, { width: 320 })?.headersRef).toBeDefined();
  });

  it('takes the site’s own CDN as it is, and sends it no sign-in', async () => {
    const { provider } = await connect({ routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: fixtures.video } } });
    const resolveImage = provider.resolveImage;
    const getItem = provider.getItem;
    if (!getItem || !resolveImage) throw new Error('image members are missing');
    const ref = (await getItem('dQw4w9WgXcQ')).item.images.thumb;
    if (!ref) throw new Error('no thumbnail');
    expect(resolveImage(ref, { width: 320 })).toEqual({ uri: 'https://i.example/medium.jpg' });
  });

  it('draws nothing for a picture no answer has named yet', async () => {
    const { provider } = await connect({});
    expect(provider.resolveImage?.('v/dQw4w9WgXcQ' as never, { width: 320 })).toBeNull();
  });

  it('takes a channel’s avatar from what the server said, the size asked for', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/channels/UCuAXFkgsw1L7xaCfnd5JJOw': { status: 200, json: fixtures.channel } },
    });
    const getItem = provider.getItem;
    const resolveImage = provider.resolveImage;
    if (!getItem || !resolveImage) throw new Error('image members are missing');
    const detail = await getItem('channel:UCuAXFkgsw1L7xaCfnd5JJOw');
    const ref = detail.item.images.avatar;
    if (!ref) throw new Error('no avatar');
    expect(resolveImage(ref, { width: 90 })?.uri).toBe('https://i.example/avatar100.jpg');
    expect(resolveImage(ref, { width: 400 })?.uri).toBe('https://i.example/avatar512.jpg');
    // And its banner, the wide picture across its page.
    const banner = detail.item.images.backdrop;
    if (!banner) throw new Error('no banner');
    expect(resolveImage(banner, { width: 1200 })?.uri).toBe('https://i.example/banner2120.jpg');
  });

  it('resolves the header to the same Basic sign-in', async () => {
    const { provider } = await connect({
      credentials: { password: 'hunter2' },
      routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: proxied } },
    });
    const getItem = provider.getItem;
    const resolveImage = provider.resolveImage;
    const resolveHeaders = provider.resolveHeaders;
    if (!getItem || !resolveImage || !resolveHeaders) throw new Error('image members are missing');
    await getItem('dQw4w9WgXcQ');
    const source = resolveImage('v/dQw4w9WgXcQ' as never, { width: 320 });
    const ref = source?.headersRef;
    if (!ref) throw new Error('no header ref');
    expect(await resolveHeaders(ref)).toEqual({ Authorization: `Basic ${encodeBase64(encodeUtf8('alex:hunter2'))}` });
  });
});

describe('Yattee — playing', () => {
  const descriptor = (provider: ConnectedMediaProvider, profile: PlayerProfile = EVERYTHING) => {
    const get = provider.getPlaybackDescriptor;
    if (!get) throw new Error('getPlaybackDescriptor is missing');
    return get({ key: { connectionId: 'connection-1' as never, externalId: 'dQw4w9WgXcQ' }, profile });
  };

  it('offers the muxed streams, tallest first, and nothing adaptive', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: fixtures.video } },
    });
    const plan = await descriptor(provider);
    expect(plan.sources.map((source) => source.height)).toEqual([720, 360]);
    // 1080p is in adaptiveFormats, video-only: no engine here is handed a
    // manifest, so it must not be offered as if it were playable.
    expect(plan.sources.every((source) => source.uri.includes('relay'))).toBe(true);
    expect(plan.sources).toHaveLength(2);
    expect(plan.sources[0]?.protocol).toBe('progressive');
    expect(plan.sources[0]?.container).toBe('mp4');
    expect(plan.sources[0]?.videoCodec).toBe('h264');
    expect(plan.sources[0]?.audioCodecs).toEqual(['aac']);
    // Nothing is re-encoded: these are the renditions the site published.
    expect(plan.sources.every((source) => !source.transcoded)).toBe(true);
    expect(plan.durationMs).toBe(213_000);
  });

  it('keeps within the height the chosen player allows', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: fixtures.video } },
    });
    const plan = await descriptor(provider, { ...EVERYTHING, maxHeight: 480 });
    expect(plan.sources.map((source) => source.height)).toEqual([360]);
  });

  it('offers something rather than nothing when no rendition fits', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: fixtures.video } },
    });
    const plan = await descriptor(provider, { ...EVERYTHING, maxHeight: 144 });
    expect(plan.sources).toHaveLength(2);
  });

  it('carries the captions as external subtitle tracks', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: fixtures.video } },
    });
    const plan = await descriptor(provider);
    expect(plan.subtitleTracks.map((track) => track.language)).toEqual(['en', 'de']);
    expect(plan.subtitleTracks[0]?.delivery).toBe('external');
    expect(plan.subtitleTracks[0]?.uri).toBe('https://yt.test/api/v1/captions/dQw4w9WgXcQ/content?lang=en&token=abc');
  });

  it('says a live video is live, and claims no duration for it', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/videos/live1234567': { status: 200, json: fixtures.liveVideo } },
    });
    const get = provider.getPlaybackDescriptor;
    if (!get) throw new Error('getPlaybackDescriptor is missing');
    const plan = await get({
      key: { connectionId: 'connection-1' as never, externalId: 'live1234567' },
      profile: EVERYTHING,
    });
    expect(plan.sources[0]?.live).toBe(true);
    expect(plan.durationMs).toBeUndefined();
  });

  it('refuses plainly when the server offers nothing playable', async () => {
    const { provider } = await connect({
      routes: {
        'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: { ...fixtures.video, formatStreams: [] } },
      },
    });
    await expect(descriptor(provider)).rejects.toBeInstanceOf(AppError);
    await expect(descriptor(provider)).rejects.toMatchObject({ code: 'INVALID_STATE', retry: 'never' });
  });

  it('passes the proxy mode the connection chose', async () => {
    const { provider, http } = await connect({
      routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: fixtures.video } },
      settings: { proxyMode: 'off' },
    });
    await descriptor(provider);
    expect(http.to('GET /api/v1/videos/dQw4w9WgXcQ')[0]?.query.proxy_mode).toBe('off');
  });
});

describe('Yattee — the latest from channels someone follows', () => {
  it('asks for them all at once, because the server keeps no list of its own', async () => {
    const { provider, http } = await connect({
      routes: { 'POST /api/v1/feed': { status: 200, json: fixtures.channelVideos } },
    });
    const feed = provider.listFeed;
    if (!feed) throw new Error('listFeed is missing');
    const page = await feed(['UC1', 'UC2'], { kind: 'videos', sort: { by: 'addedAt', order: 'desc' }, limit: 2 });
    expect(page.items.map((item) => item.title)).toEqual(['The channel’s newest', 'The one before it']);
    const body = JSON.parse(http.to('POST /api/v1/feed')[0]?.body ?? '{}') as { channels: string[]; limit: number; offset: number };
    expect(body).toEqual({ channels: ['UC1', 'UC2'], limit: 2, offset: 0 });
    expect(page.nextCursor).toBe('1');
  });

  it('asks nothing when nobody is followed', async () => {
    const { provider, http } = await connect({});
    const feed = provider.listFeed;
    if (!feed) throw new Error('listFeed is missing');
    expect(await feed([], { kind: 'videos', sort: { by: 'addedAt', order: 'desc' }, limit: 10 })).toEqual({ items: [] });
    expect(http.to('POST /api/v1/feed')).toHaveLength(0);
  });
});

describe('Yattee — keeping a copy', () => {
  it('offers every rendition, with what each weighs', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: fixtures.video } },
    });
    const list = provider.listDownloadOptions;
    if (!list) throw new Error('listDownloadOptions is missing');
    const options = await list({ connectionId: 'connection-1' as never, externalId: 'dQw4w9WgXcQ' });
    expect(options.map((option) => option.height)).toEqual([1080, 720, 360]);
    expect(options[0]).toMatchObject({ label: '1080p', estimatedBytes: 112_328_704, container: 'mp4', transcoded: false });
    // Nothing is re-encoded: the server fetches and muxes what already exists.
    expect(options.every((option) => !option.transcoded)).toBe(true);
  });

  it('fetches through the muxing proxy, at the height chosen', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: fixtures.video } },
    });
    const get = provider.getDownloadDescriptor;
    if (!get) throw new Error('getDownloadDescriptor is missing');
    const plan = await get({ key: { connectionId: 'connection-1' as never, externalId: 'dQw4w9WgXcQ' }, optionId: '18' });
    // 360p is itag 18: the selector caps the merge at that height.
    expect(plan.uri).toContain('/proxy/fast/dQw4w9WgXcQ');
    expect(decodeURIComponent(plan.uri)).toContain('height<=360');
    expect(plan.height).toBe(360);
    expect(plan.container).toBe('mp4');
    expect(plan.transcoded).toBe(false);
    expect(plan.expectedBytes).toBe(18_874_368);
    // The address carries the sign-in through a ref, never inline.
    expect(plan.headersRef).toBeDefined();
  });

  it('takes the best rendition when nothing was chosen', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: fixtures.video } },
    });
    const get = provider.getDownloadDescriptor;
    if (!get) throw new Error('getDownloadDescriptor is missing');
    const plan = await get({ key: { connectionId: 'connection-1' as never, externalId: 'dQw4w9WgXcQ' } });
    expect(plan.height).toBe(1080);
  });

  it('keeps the captions beside the file', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, json: fixtures.video } },
    });
    const get = provider.getDownloadDescriptor;
    if (!get) throw new Error('getDownloadDescriptor is missing');
    const plan = await get({ key: { connectionId: 'connection-1' as never, externalId: 'dQw4w9WgXcQ' } });
    expect(plan.subtitles.map((track) => track.language)).toEqual(['en', 'de']);
    expect(plan.subtitles[0]?.uri).toContain('/api/v1/captions/');
  });

  it('refuses rather than guessing when the site published nothing', async () => {
    const { provider } = await connect({
      routes: {
        'GET /api/v1/videos/dQw4w9WgXcQ': {
          status: 200,
          json: { ...fixtures.video, formatStreams: [], adaptiveFormats: [] },
        },
      },
    });
    const get = provider.getDownloadDescriptor;
    if (!get) throw new Error('getDownloadDescriptor is missing');
    await expect(get({ key: { connectionId: 'connection-1' as never, externalId: 'dQw4w9WgXcQ' } })).rejects.toMatchObject({
      code: 'INVALID_STATE',
      retry: 'never',
    });
  });
});

describe('Yattee — what it refuses to guess', () => {
  it('calls an unreadable answer unreadable rather than empty', async () => {
    const { provider } = await connect({
      routes: { 'GET /api/v1/videos/dQw4w9WgXcQ': { status: 200, text: 'not json' } },
    });
    const getItem = provider.getItem;
    if (!getItem) throw new Error('getItem is missing');
    await expect(getItem('dQw4w9WgXcQ')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('drops a video with no id rather than inventing one', async () => {
    const { provider } = await connect({
      routes: {
        'GET /api/v1/trending': { status: 200, json: [{ title: 'No id at all' }, fixtures.video] },
      },
    });
    const page = await listVideos(provider);
    expect(page.items).toHaveLength(1);
  });
});
