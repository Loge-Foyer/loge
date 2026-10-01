import type { Channel, ChannelGroup, ConnectionId, Episode, MediaDetail, Movie, Programme, Season, Show } from '@sc/api';

/**
 * A fixed lineup: the same channels, the same guide and the same films and
 * series on every run, so a screenshot or a test sees what it saw last time.
 * The guide is a pure function of the channel and the time, so any window of
 * it can be asked for and always agrees with itself.
 */
export interface Lineup {
  readonly groups: readonly ChannelGroup[];
  readonly channels: readonly Channel[];
  /** Which channels only offer raw MPEG-TS — not every engine plays it. */
  readonly transportStreamOnly: ReadonlySet<string>;
  readonly movies: readonly Movie[];
  readonly shows: readonly Show[];
  readonly seasons: ReadonlyMap<string, readonly Season[]>;
  readonly episodes: ReadonlyMap<string, readonly Episode[]>;
  readonly details: ReadonlyMap<string, MediaDetail>;
}

export type LineupSize = 'small' | 'large';

const GROUPS: readonly ChannelGroup[] = [
  { id: 'news', name: 'News' },
  { id: 'sports', name: 'Sports' },
  { id: 'films', name: 'Films' },
  { id: 'kids', name: 'Kids' },
  { id: 'music', name: 'Music' },
];

const CHANNEL_NAMES: Readonly<Record<string, readonly string[]>> = {
  news: ['Morning Wire', 'Global Desk', 'City Report', 'Market Watch'],
  sports: ['Stadium One', 'Track & Field', 'Goal Line', 'Court Side'],
  films: ['Matinee', 'Double Feature', 'Late Show', 'Classics'],
  kids: ['Playground', 'Cartoon Hour', 'Little Explorers', 'Story Time'],
  music: ['Loud', 'Unplugged', 'Chart Run', 'Jazz Club'],
};

const SHOW_WORDS: Readonly<Record<string, readonly string[]>> = {
  news: ['Headlines', 'The Briefing', 'Weather', 'In Depth', 'Business Hour'],
  sports: ['Match Day', 'Highlights', 'Live: The Final', 'Studio Talk', 'Classic Games'],
  films: ['The Silent Harbor', 'Paper Orbit', 'Northern Signal', 'Crimson Tide', 'The Last Lantern'],
  kids: ['Robo Pals', 'Forest Friends', 'Build It!', 'Sing Along', 'Space Cadets'],
  music: ['Top Twenty', 'Live Session', 'Rewind', 'New Releases', 'Late Grooves'],
};

const MOVIE_TITLES = ['Harbor Lights', 'The Meridian', 'Quiet Engine', 'Hollow Summit', 'Golden Parade', 'Winter Garden', 'Electric Canyon', 'Distant Mirror', 'Paper Frontier', 'Broken Archive', 'Wild Tide', 'Midnight Forest'];
const SHOW_TITLES = ['The Relay', 'Northbound', 'Kitchen Stories', 'Deep Field', 'Lantern House'];
const GENRES = ['Drama', 'Comedy', 'Thriller', 'Documentary', 'Adventure', 'Animation'];

// Everything "happened" before this moment, so dates never move between runs.
const EPOCH = Date.UTC(2026, 8, 1);
const HALF_HOUR = 30 * 60 * 1000;

export function createLineup(connectionId: ConnectionId, size: LineupSize): Lineup {
  const key = (externalId: string) => ({ connectionId, externalId });
  const perGroup = size === 'large' ? 40 : 4;
  const channels: Channel[] = [];
  const transportStreamOnly = new Set<string>();
  let number = 100;
  for (const group of GROUPS) {
    const names = CHANNEL_NAMES[group.id] ?? [];
    for (let index = 0; index < perGroup; index += 1) {
      number += 1;
      const externalId = `channel-${number}`;
      channels.push({
        key: key(externalId),
        name: `${names[index % names.length]}${index >= names.length ? ` ${Math.floor(index / names.length) + 1}` : ''}`,
        number,
        groupIds: [group.id],
        ...(group.id === 'sports' || group.id === 'news' ? { catchupDays: 7 } : {}),
      });
      // One in every group plays only as raw MPEG-TS: AVPlayer cannot, so the app has to say which player would.
      if (index === perGroup - 1) transportStreamOnly.add(externalId);
    }
  }

  const movies: Movie[] = MOVIE_TITLES.map((title, index) => ({
    type: 'movie',
    key: key(`vod-movie-${index + 1}`),
    title,
    year: 2014 + (index % 12),
    releaseDate: `${2014 + (index % 12)}-0${(index % 9) + 1}-15`,
    addedAt: new Date(EPOCH - index * 86_400_000).toISOString(),
    runtimeMs: (85 + (index % 5) * 12) * 60_000,
    ratings: { community: 5 + (index % 5) },
    genres: [GENRES[index % GENRES.length] ?? 'Drama'],
    images: {},
  }));

  const shows: Show[] = [];
  const seasons = new Map<string, Season[]>();
  const episodes = new Map<string, Episode[]>();
  SHOW_TITLES.forEach((title, index) => {
    const showId = `vod-show-${index + 1}`;
    const seasonCount = 1 + (index % 3);
    const show: Show = {
      type: 'show',
      key: key(showId),
      title,
      year: 2018 + index,
      releaseDate: `${2018 + index}-03-01`,
      addedAt: new Date(EPOCH - (index + 20) * 86_400_000).toISOString(),
      ratings: { community: 6 + (index % 4) },
      genres: [GENRES[(index + 2) % GENRES.length] ?? 'Drama'],
      images: {},
      seasonCount,
      episodeCount: seasonCount * 6,
      status: index % 2 === 0 ? 'continuing' : 'ended',
    };
    shows.push(show);
    const showSeasons: Season[] = [];
    for (let s = 1; s <= seasonCount; s += 1) {
      const seasonId = `${showId}-s${s}`;
      showSeasons.push({ type: 'season', key: key(seasonId), title: `Season ${s}`, show: show.key, showTitle: title, seasonNumber: s, episodeCount: 6, ratings: {}, genres: [], images: {} });
      const list: Episode[] = [];
      for (let e = 1; e <= 6; e += 1) {
        list.push({
          type: 'episode',
          key: key(`${seasonId}-e${e}`),
          title: `Episode ${e}`,
          show: show.key,
          season: key(seasonId),
          showTitle: title,
          seasonNumber: s,
          episodeNumber: e,
          runtimeMs: 42 * 60_000,
          ratings: {},
          genres: [],
          images: {},
        });
      }
      episodes.set(seasonId, list);
    }
    seasons.set(showId, showSeasons);
  });

  const details = new Map<string, MediaDetail>();
  for (const item of [...movies, ...shows]) {
    details.set(item.key.externalId, { item: { ...item, overview: `${item.title}, as the mock portal offers it.` }, people: [], studios: ['Mock Portal'], externalIds: {} });
  }

  return { groups: GROUPS, channels, transportStreamOnly, movies, shows, seasons, episodes, details };
}

/**
 * What a channel airs in a window. Time runs in blocks of an hour and a half —
 * an hour-long programme, then a half-hour one — shifted per channel, so any
 * two windows agree wherever they overlap.
 */
export function guideFor(channel: Channel, from: number, to: number): readonly Programme[] {
  const group = channel.groupIds[0] ?? 'news';
  const words = SHOW_WORDS[group] ?? [];
  const seed = channel.number ?? 0;
  const offset = (seed % 3) * HALF_HOUR;
  const block = 3 * HALF_HOUR;
  const programmes: Programme[] = [];
  for (let index = Math.floor((from + offset) / block); index * block - offset < to; index += 1) {
    const blockStart = index * block - offset;
    for (const [part, start, end] of [
      [0, blockStart, blockStart + 2 * HALF_HOUR],
      [1, blockStart + 2 * HALF_HOUR, blockStart + block],
    ] as const) {
      if (end <= from || start >= to) continue;
      const title = words[(index * 2 + part + seed) % words.length] ?? 'Programme';
      programmes.push({
        channel: channel.key,
        title,
        description: `${title}, on ${channel.name}.`,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
      });
    }
  }
  return programmes;
}
