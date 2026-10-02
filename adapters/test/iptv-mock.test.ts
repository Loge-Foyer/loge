import {
  choosePlayer,
  compareItems,
  connectionId,
  effectiveCapabilities,
  pluginId,
  type Channel,
  type ChannelPage,
  type ConnectedMediaProvider,
  type FieldValues,
  type ItemPage,
  type MediaItem,
  type PlayerProfile,
} from '@loge/api';
import { plugin } from '@loge/iptv-mock';
import { describe, expect, it } from 'vitest';

import { fakeContext, fakeHttp, target } from './support/fake-http';

async function connect(settings: FieldValues = {}, fields: FieldValues = {}) {
  const fake = fakeContext({ http: fakeHttp({}).client });
  const media = plugin.media;
  if (!media) throw new Error('The mock portal has no media role.');
  return { provider: await media.connect(target(fields, settings), fake.context), fake };
}

function need<K extends keyof ConnectedMediaProvider>(provider: ConnectedMediaProvider, member: K): NonNullable<ConnectedMediaProvider[K]> {
  const found = provider[member];
  if (found === undefined) throw new Error(`${member} is missing`);
  return found as NonNullable<ConnectedMediaProvider[K]>;
}

async function allChannels(provider: ConnectedMediaProvider, groupId?: string, limit = 7): Promise<Channel[]> {
  const listChannels = need(provider, 'listChannels');
  const channels: Channel[] = [];
  let page: ChannelPage | undefined;
  do {
    page = await listChannels({ limit, ...(groupId ? { groupId } : {}), ...(page?.nextCursor ? { cursor: page.nextCursor } : {}) });
    channels.push(...page.channels);
  } while (page.nextCursor);
  return channels;
}

async function allItems(provider: ConnectedMediaProvider, kind: 'movies' | 'shows' | 'live', limit = 5): Promise<MediaItem[]> {
  const listItems = need(provider, 'listItems');
  const items: MediaItem[] = [];
  let page: ItemPage | undefined;
  do {
    page = await listItems({ kind, sort: { by: 'title', order: 'asc' }, limit, ...(page?.nextCursor ? { cursor: page.nextCursor } : {}) });
    items.push(...page.items);
  } while (page.nextCursor);
  return items;
}

// Rough shapes of the engines: AVPlayer has no raw MPEG-TS, ExoPlayer has.
const avplayer: PlayerProfile = { protocols: ['progressive', 'hls'], containers: ['mp4', 'ts'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: ['vtt'] };
const exoplayer: PlayerProfile = { ...avplayer, protocols: ['progressive', 'hls', 'mpegts'] };
const system = pluginId('players/system');

describe('iptv/mock', () => {
  it('serves the same lineup every time: a few channels, or many', async () => {
    const first = await allChannels((await connect()).provider);
    expect(await allChannels((await connect()).provider)).toEqual(first);
    expect(first).toHaveLength(20);
    const numbers = first.map((channel) => channel.number ?? 0);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(await allChannels((await connect({}, { lineupSize: 'large' })).provider, undefined, 50)).toHaveLength(200);
  });

  it('pages channels without duplicates or gaps, and by group', async () => {
    const { provider } = await connect();
    const groups = await need(provider, 'listChannelGroups')();
    expect(groups.map((group) => group.name)).toEqual(['News', 'Sports', 'Films', 'Kids', 'Music']);
    const all = await allChannels(provider, undefined, 3);
    expect(new Set(all.map((channel) => channel.key.externalId)).size).toBe(all.length);
    let counted = 0;
    for (const group of groups) {
      const inGroup = await allChannels(provider, group.id, 3);
      expect(inGroup.length).toBeGreaterThan(0);
      expect(inGroup.every((channel) => channel.groupIds.includes(group.id))).toBe(true);
      counted += inGroup.length;
    }
    expect(counted).toBe(all.length);
  });

  it('has a guide with no gaps or overlaps, the same in any window', async () => {
    const { provider } = await connect();
    const getGuide = need(provider, 'getGuide');
    const [channel] = await allChannels(provider);
    if (!channel) throw new Error('no channel');
    const from = Date.UTC(2026, 8, 30, 6, 10);
    const day = await getGuide({ channels: [channel.key], from: new Date(from).toISOString(), to: new Date(from + 86_400_000).toISOString() });
    expect(Date.parse(day[0]?.startsAt ?? '')).toBeLessThanOrEqual(from);
    expect(Date.parse(day.at(-1)?.endsAt ?? '')).toBeGreaterThanOrEqual(from + 86_400_000);
    for (let index = 1; index < day.length; index += 1) expect(day[index]?.startsAt).toBe(day[index - 1]?.endsAt);
    // Now and next, asked for alone, are the day's own.
    const now = from + 3 * 3_600_000 + 7 * 60_000;
    const nowAndNext = await getGuide({ channels: [channel.key], from: new Date(now).toISOString(), to: new Date(now + 1).toISOString() });
    expect(nowAndNext).toHaveLength(1);
    expect(day).toContainEqual(nowAndNext[0]);
  });

  it('gives no guide for another connection’s channel', async () => {
    const { provider } = await connect();
    const [channel] = await allChannels(provider);
    if (!channel) throw new Error('no channel');
    const stranger = { ...channel.key, connectionId: connectionId('connection-2') };
    const window = { from: '2026-09-30T06:00:00Z', to: '2026-09-30T08:00:00Z' };
    expect(await need(provider, 'getGuide')({ channels: [stranger], ...window })).toEqual([]);
  });

  it('switches the guide off with its setting', () => {
    const on = effectiveCapabilities(plugin.manifest, { enabled: true, settings: {} }).media?.capabilities;
    const off = effectiveCapabilities(plugin.manifest, { enabled: true, settings: { guide: false } }).media?.capabilities;
    expect(on?.has('epg')).toBe(true);
    expect(off?.has('epg')).toBe(false);
    expect(off?.has('channels')).toBe(true);
  });

  it('has films and series in the order asked, and no live items', async () => {
    const { provider } = await connect();
    const movies = await allItems(provider, 'movies');
    expect(movies.length).toBeGreaterThan(5);
    expect(movies).toEqual([...movies].sort(compareItems({ by: 'title', order: 'asc' })));
    const [show] = await allItems(provider, 'shows');
    if (!show) throw new Error('no show');
    const getChildren = need(provider, 'getChildren');
    const [season] = (await getChildren(show)).items;
    if (!season) throw new Error('no season');
    expect((await getChildren(season)).items).toHaveLength(6);
    expect(await allItems(provider, 'live')).toEqual([]);
  });

  it('plays a channel live over HLS — and one in every group only as MPEG-TS, which AVPlayer cannot', async () => {
    const { provider } = await connect();
    const descriptorOf = need(provider, 'getPlaybackDescriptor');
    const channels = await allChannels(provider);
    const descriptors = await Promise.all(channels.map((channel) => descriptorOf({ key: channel.key, profile: avplayer })));
    expect(descriptors.every((descriptor) => descriptor.sources.every((source) => source.live))).toBe(true);
    const transportOnly = descriptors.filter((descriptor) => descriptor.sources.every((source) => source.protocol === 'mpegts'));
    expect(transportOnly).toHaveLength(5);
    for (const descriptor of transportOnly) {
      expect(choosePlayer(descriptor.sources, [{ id: system, profile: avplayer }])).toEqual({ kind: 'none' });
      expect(choosePlayer(descriptor.sources, [{ id: system, profile: exoplayer }])).toMatchObject({ kind: 'play' });
    }
    const hls = descriptors.filter((descriptor) => descriptor.sources[0]?.protocol === 'hls');
    expect(hls).toHaveLength(15);
    for (const descriptor of hls) expect(choosePlayer(descriptor.sources, [{ id: system, profile: avplayer }])).toMatchObject({ kind: 'play' });
    // A live stream, and the two looped as if they were.
    expect(new Set(hls.map((descriptor) => descriptor.sources[0]?.uri)).size).toBe(3);
  });

  it('plays a film from a file, from where it is asked to start — and nothing of another connection', async () => {
    const { provider } = await connect();
    const descriptorOf = need(provider, 'getPlaybackDescriptor');
    const [movie] = await allItems(provider, 'movies');
    if (!movie) throw new Error('no movie');
    const descriptor = await descriptorOf({ key: movie.key, profile: avplayer, startMs: 42_000 });
    expect(descriptor.sources[0]).toMatchObject({ protocol: 'progressive', container: 'mp4', live: false });
    expect(descriptor.startMs).toBe(42_000);
    await expect(descriptorOf({ key: { ...movie.key, connectionId: connectionId('connection-2') }, profile: avplayer })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(descriptorOf({ key: { ...movie.key, externalId: 'nothing' }, profile: avplayer })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('declines artwork, watch state and libraries', async () => {
    const { provider } = await connect();
    for (const member of ['resolveImage', 'getResume', 'reportPlayback', 'setPlayed', 'getLibraries'] as const) {
      expect(provider[member], member).toBeUndefined();
    }
    expect(plugin.manifest.media?.capabilities).not.toContain('watchStateRead');
    expect(plugin.manifest.media?.capabilities).not.toContain('remoteImages');
  });

  it('is slow through the injected clock, and flaky every third call', async () => {
    const slow = await connect({ latency: 'slow' });
    await slow.provider.check();
    expect(slow.fake.sleeps).toEqual([1_500]);
    const flaky = await connect({ latency: 'flaky' });
    await flaky.provider.check();
    await flaky.provider.check();
    await expect(flaky.provider.check()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff' });
  });
});
