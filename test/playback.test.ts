import {
  AppError,
  type ConnectionId,
  type Episode,
  type MediaItem,
  type PlaybackDescriptor,
  type PlaybackRequest,
  type PlaybackSource,
  type PlayerEvent,
  type PlayerProfile,
} from '@sc/api';
import { describe, expect, it } from 'vitest';

import { initialDraft, setSecret, setValue } from '@/services/connection-draft';
import { playbackReports } from '@/services/playback-reports';
import { tabOfPlaying } from '@/services/tab-content';

import { fakeClock } from './support/fakes';
import { buildServices, fakeMediaPlugin, fakePlayerPlugin, movie } from './support/services';

const hlsOnly: PlayerProfile = { protocols: ['progressive', 'hls'], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: ['vtt'] };
const everything: PlayerProfile = { ...hlsOnly, protocols: ['progressive', 'hls', 'mpegts'], containers: ['mp4', 'ts', 'mkv'] };
const hls: PlaybackSource = { uri: 'https://home/master.m3u8?api_key=t', protocol: 'hls', transcoded: true, live: false };
const ts: PlaybackSource = { uri: 'https://portal/live.ts', protocol: 'mpegts', container: 'ts', transcoded: false, live: true };

function episode(connectionId: ConnectionId, season: number, number: number): Episode {
  return {
    type: 'episode',
    key: { connectionId, externalId: `s${season}e${number}` },
    title: `Episode ${number}`,
    show: { connectionId, externalId: 'show' },
    season: { connectionId, externalId: `s${season}` },
    showTitle: 'The Show',
    seasonNumber: season,
    episodeNumber: number,
    ratings: {},
    genres: [],
    images: {},
  };
}

async function setUp(options: { players?: ReturnType<typeof fakePlayerPlugin>[]; describe?: (request: PlaybackRequest) => PlaybackDescriptor; canPlay?: boolean } = {}) {
  const source = fakeMediaPlugin('home', {
    movies: (id) => [movie(id, 'm1', 2020)],
    children: (parent) =>
      parent.type === 'show'
        ? [1, 2].map((number) => ({ type: 'season' as const, key: { connectionId: parent.key.connectionId, externalId: `s${number}` }, title: `Season ${number}`, show: parent.key, seasonNumber: number, ratings: {}, genres: [], images: {} }))
        : parent.type === 'season'
          ? [1, 2].map((number) => episode(parent.key.connectionId, Number(parent.key.externalId.slice(1)), number))
          : [],
    ...(options.canPlay === false ? {} : { playback: options.describe ?? ((request) => ({ key: request.key, sources: [hls], audioTracks: [], subtitleTracks: [] })) }),
  });
  const players = options.players ?? [fakePlayerPlugin('first', { ios: hlsOnly }), fakePlayerPlugin('second', { ios: everything })];
  const built = buildServices({ plugins: [source.plugin, ...players.map((player) => player.plugin)], players: players.map((player) => player.plugin) });
  const kids = await built.services.profiles.create('Kids');
  let draft = initialDraft(source.manifest, 0);
  draft = setValue(source.manifest, draft, kids.id, 'fields', 'serverUrl', 'http://home:8096');
  draft = setValue(source.manifest, draft, kids.id, 'fields', 'username', 'family');
  draft = setSecret(draft, kids.id, 'password', 'secret');
  const connection = await built.services.connections.create(source.manifest.id, draft);
  return { ...built, source, players, kids: kids.id, connectionId: connection.id, item: movie(connection.id, 'm1', 2020) as MediaItem };
}

describe('choosing a player', () => {
  it('offers the players on with a profile for this platform, in the catalogue’s order, and the one that plays first', async () => {
    const t = await setUp({ players: [fakePlayerPlugin('first', { ios: hlsOnly }), fakePlayerPlugin('web-only', { web: hlsOnly }), fakePlayerPlugin('second', { ios: everything })] });
    const ids = (await t.services.players.choosing()).candidates.map((candidate) => candidate.id);
    expect(ids).toEqual(['players/first', 'players/second']);
    await t.services.players.setPreferred(t.players[2]?.plugin.manifest.id ?? ('' as never));
    expect((await t.services.players.choosing()).preferred).toBe('players/second');
    await t.services.players.setEnabled(t.players[2]?.plugin.manifest.id ?? ('' as never), false);
    expect(await t.services.players.choosing()).toEqual({ candidates: [expect.objectContaining({ id: 'players/first' })], preferred: 'players/first' });
  });

  it('puts a tab’s own first before the device’s — while it is on, and only on that tab', async () => {
    const t = await setUp();
    const second = t.players[1]?.plugin.manifest.id ?? ('' as never);
    await t.services.players.setFirstOn(second, 'tv', true);
    expect((await t.services.players.choosing('tv')).preferred).toBe('players/second');
    expect((await t.services.players.choosing('media')).preferred).toBe('players/first');
    expect((await t.services.players.choosing()).preferred).toBe('players/first');
    await t.services.players.setEnabled(second, false);
    expect((await t.services.players.choosing('tv')).preferred).toBe('players/first');
    // Chosen for a tab again, it is switched on again.
    await t.services.players.setFirstOn(second, 'tv', true);
    expect((await t.services.players.choosing('tv')).preferred).toBe('players/second');
  });
});

describe('the tab something plays from', () => {
  it('is TV for a channel and for everything IPTV brings, and Media for a source’s films and series', () => {
    expect(tabOfPlaying('sources', true)).toBe('tv');
    expect(tabOfPlaying('iptv', false)).toBe('tv');
    expect(tabOfPlaying('sources', false)).toBe('media');
  });
});

describe('pressing Play', () => {
  it('asks the source for a stream fit for the player that plays first, and plays it there', async () => {
    const t = await setUp();
    const plan = await t.services.playback.plan(t.kids, t.item.key, { startMs: 90_000 });
    expect(t.source.stats.playbackRequests).toEqual([{ key: t.item.key, profile: hlsOnly, startMs: 90_000 }]);
    expect(plan).toMatchObject({ kind: 'play', player: 'players/first', source: hls });
  });

  it('asks with the profile of the player first on the item’s tab: a channel plays from TV', async () => {
    const t = await setUp();
    await t.services.players.setFirstOn(t.players[1]?.plugin.manifest.id ?? ('' as never), 'tv', true);
    expect(await t.services.playback.plan(t.kids, t.item.key)).toMatchObject({ kind: 'play', player: 'players/first' });
    expect(await t.services.playback.plan(t.kids, t.item.key, { live: true })).toMatchObject({ kind: 'play', player: 'players/second' });
    expect(t.source.stats.playbackRequests.map((request) => request.profile)).toEqual([hlsOnly, everything]);
    // The tab is the app's business, not the source's.
    expect(t.source.stats.playbackRequests.every((request) => !('live' in request))).toBe(true);
  });

  it('plays with the player the user picked, asked with its profile — or not at all, never with another', async () => {
    const t = await setUp();
    const second = t.players[1]?.plugin.manifest.id ?? ('' as never);
    expect(await t.services.playback.plan(t.kids, t.item.key, { player: second })).toMatchObject({ kind: 'play', player: 'players/second', source: hls });
    expect(t.source.stats.playbackRequests.at(-1)?.profile).toEqual(everything);

    const first = t.players[0]?.plugin.manifest.id ?? ('' as never);
    const onlyTs = await setUp({ describe: (request) => ({ key: request.key, sources: [ts], audioTracks: [], subtitleTracks: [] }) });
    expect(await onlyTs.services.playback.plan(onlyTs.kids, onlyTs.item.key, { player: first })).toEqual({ kind: 'none', needs: ['protocol'], source: ts });

    await t.services.players.setEnabled(second, false);
    await expect(t.services.playback.plan(t.kids, t.item.key, { player: second })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('finds the player that can, when the first cannot', async () => {
    const t = await setUp({ describe: (request) => ({ key: request.key, sources: [ts], audioTracks: [], subtitleTracks: [] }) });
    expect(await t.services.playback.plan(t.kids, t.item.key)).toMatchObject({ kind: 'play', player: 'players/second', source: ts });
  });

  it('says what no player here can do', async () => {
    const t = await setUp({
      players: [fakePlayerPlugin('first', { ios: hlsOnly })],
      describe: (request) => ({ key: request.key, sources: [ts], audioTracks: [], subtitleTracks: [] }),
    });
    // A stream's container is its protocol's: only the protocol is missing.
    expect(await t.services.playback.plan(t.kids, t.item.key)).toEqual({ kind: 'none', needs: ['protocol'], source: ts });
  });

  it('says so when every player is switched off here, without asking the source', async () => {
    const t = await setUp({ players: [fakePlayerPlugin('first', { ios: hlsOnly })] });
    await t.services.players.setEnabled(t.players[0]?.plugin.manifest.id ?? ('' as never), false);
    expect(await t.services.playback.plan(t.kids, t.item.key)).toEqual({ kind: 'no-player' });
    expect(t.source.stats.playbackRequests).toEqual([]);
  });

  it('refuses an item from a source that cannot play', async () => {
    const t = await setUp({ canPlay: false });
    await expect(t.services.playback.plan(t.kids, t.item.key)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('parks a source that refused its sign-in, as every call to it does', async () => {
    let refused = true;
    const t = await setUp({
      describe: () => {
        if (refused) throw new AppError('UNAUTHORIZED', 'No.', { retry: 'never' });
        return { key: t.item.key, sources: [hls], audioTracks: [], subtitleTracks: [] };
      },
    });
    await expect(t.services.playback.plan(t.kids, t.item.key)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    refused = false;
    await expect(t.services.playback.plan(t.kids, t.item.key)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    t.services.media.unpark();
    expect(await t.services.playback.plan(t.kids, t.item.key)).toMatchObject({ kind: 'play' });
  });

  it('makes a controller whose headers come from the item’s source', async () => {
    const t = await setUp();
    await t.services.media.row(t.kids, { kind: 'movies', sort: { by: 'title', order: 'asc' } }, 5);
    t.services.playback.create(t.kids, t.players[0]?.plugin.manifest.id ?? ('' as never), t.connectionId);
    const [made] = t.players[0]?.made ?? [];
    await expect(made?.context.resolveHeaders('stream' as never)).resolves.toEqual({ Authorization: 'Token t' });
    expect(t.services.playback.view(t.players[0]?.plugin.manifest.id ?? ('' as never))).toBe(t.players[0]?.plugin.View);
  });

  it('finds the next episode: the next in its season, then the next season’s first, then none', async () => {
    const t = await setUp();
    const next = (season: number, number: number) => t.services.playback.nextEpisode(t.kids, episode(t.connectionId, season, number));
    expect((await next(1, 1))?.key.externalId).toBe('s1e2');
    expect((await next(1, 2))?.key.externalId).toBe('s2e1');
    expect(await next(2, 2)).toBeUndefined();
  });
});

describe('reporting what is played', () => {
  function session(options: { live?: boolean } = {}) {
    const clock = fakeClock();
    const reports: string[] = [];
    const item = movie('c1' as ConnectionId, 'm1', 2020);
    const watch = {
      report: async (_user: unknown, _item: unknown, report: { kind: string; positionMs: number; paused?: boolean }) => {
        reports.push(`${report.kind} ${report.positionMs}${report.paused ? ' paused' : ''}`);
      },
    };
    const tracked = playbackReports({ watch, clock, userId: 'u1' as never, item, live: options.live ?? false });
    const send = (...events: PlayerEvent[]) => events.forEach((event) => tracked.event(event));
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    return { clock, reports, tracked, send, settle };
  }
  const at = (positionMs: number, durationMs = 600_000): PlayerEvent => ({ type: 'position', positionMs, durationMs });
  const state = (value: 'playing' | 'paused' | 'ended' | 'loading'): PlayerEvent => ({ type: 'state', state: value });

  it('starts when it first plays, reports every ten seconds and on a pause, and stops where it was closed', async () => {
    const t = session();
    t.send(state('loading'), at(0), state('playing'), at(5_000));
    t.clock.advance(10_000);
    t.send(at(15_000));
    t.clock.advance(4_000);
    t.send(at(19_000), state('paused'));
    await t.tracked.stop();
    await t.tracked.stop();
    expect(t.reports).toEqual(['started 0', 'progress 15000', 'progress 19000 paused', 'stopped 19000']);
  });

  it('stops at the end, once', async () => {
    const t = session();
    t.send(state('playing'), at(599_000), state('ended'));
    await t.tracked.stop();
    await t.settle();
    expect(t.reports).toEqual(['started 0', 'stopped 600000']);
  });

  it('reports nothing of a live stream, or of something that never played', async () => {
    const live = session({ live: true });
    live.send(state('playing'), at(1_000));
    await live.tracked.stop();
    const never = session();
    never.send(state('loading'));
    await never.tracked.stop();
    expect([...live.reports, ...never.reports]).toEqual([]);
  });
});
