import type {
  ConnectionId,
  ContentKind,
  Episode,
  Library,
  MediaDetail,
  MediaItem,
  Movie,
  Season,
  Show,
  VideoChannel,
  VideoPlaylist,
  WatchStatus,
} from '@sc/api';

/**
 * A fixed catalogue: the same titles, in the same state, on every run, so a
 * screenshot or a test sees exactly what it saw last time.
 */
export interface Catalogue {
  readonly libraries: readonly Library[];
  /** Films and series, each tagged with the library it lives in. */
  readonly entries: readonly { readonly item: Movie | Show; readonly libraryId: string }[];
  readonly seasons: ReadonlyMap<string, readonly Season[]>;
  readonly episodes: ReadonlyMap<string, readonly Episode[]>;
  readonly details: ReadonlyMap<string, MediaDetail>;
  /**
   * Web video, as a video site keeps it: a few channels, each with its
   * videos and a playlist — so the Videos tab, a channel's page and its
   * sections can be built with no network.
   */
  readonly videos: readonly (Movie | VideoChannel | VideoPlaylist)[];
  /** Each channel's sections, and each playlist's videos, by key. */
  readonly holds: ReadonlyMap<string, ReadonlyMap<string, readonly MediaItem[]>>;
}

export type CatalogueSize = 'small' | 'large';

const LIBRARIES: readonly Library[] = [
  { id: 'films', name: 'Films', kinds: ['movies'] },
  { id: 'series', name: 'Series', kinds: ['shows'] },
  { id: 'kids', name: 'Kids', kinds: ['movies', 'shows'] },
];

const ADJECTIVES = ['Silent', 'Crimson', 'Hidden', 'Last', 'Northern', 'Paper', 'Quiet', 'Broken', 'Golden', 'Midnight', 'Wild', 'Distant', 'Hollow', 'Electric', 'Winter'];
const NOUNS = ['Harbor', 'Orbit', 'Garden', 'Signal', 'Frontier', 'Lantern', 'Canyon', 'Archive', 'Meridian', 'Tide', 'Engine', 'Forest', 'Mirror', 'Parade', 'Summit'];
const GENRES = ['Drama', 'Comedy', 'Thriller', 'Science Fiction', 'Adventure', 'Documentary', 'Animation', 'Mystery'];
const RATINGS = ['G', 'PG', 'PG-13', 'R'];
const NAMES = ['Ada Brook', 'Milo Hart', 'Iris Vale', 'Theo Marsh', 'Nora Quill', 'Ezra Dunn', 'Lena Park', 'Owen Frost'];

const DAY_MS = 86_400_000;
// Watching "happened" before this moment, so dates never move between runs.
const EPOCH = Date.UTC(2026, 8, 1);

export function createCatalogue(connectionId: ConnectionId, size: CatalogueSize): Catalogue {
  const random = seeded(size === 'large' ? 97 : 42);
  const movieCount = size === 'large' ? 400 : 40;
  const showCount = size === 'large' ? 60 : 10;
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)] as T;
  const key = (externalId: string) => ({ connectionId, externalId });

  const entries: { item: Movie | Show; libraryId: string }[] = [];
  const seasons = new Map<string, Season[]>();
  const episodes = new Map<string, Episode[]>();
  const details = new Map<string, MediaDetail>();
  let recent = 0;
  const lastPlayed = () => new Date(EPOCH - (recent += 1) * DAY_MS).toISOString();

  for (let index = 0; index < movieCount; index += 1) {
    const title = `${pick(ADJECTIVES)} ${pick(NOUNS)}${index >= ADJECTIVES.length * 2 ? ` ${Math.floor(index / 15) + 1}` : ''}`;
    const year = 1972 + Math.floor(random() * 54);
    const runtimeMs = (80 + Math.floor(random() * 70)) * 60_000;
    const inProgress = index % 5 === 2;
    const watch: WatchStatus = index % 7 === 0
      ? { played: true, lastPlayedAt: lastPlayed() }
      : inProgress
        ? { played: false, positionMs: Math.round(runtimeMs * 0.45), progress: 0.45, lastPlayedAt: lastPlayed() }
        : { played: false };
    // Some titles carry only a year, some no rating: the gaps real servers have.
    const movie: Movie = {
      type: 'movie',
      key: key(`movie-${index}`),
      title,
      ...(index % 9 === 4 ? {} : { releaseDate: `${year}-${pad(1 + (index % 12))}-${pad(1 + (index % 27))}` }),
      year,
      addedAt: new Date(EPOCH - index * 3 * DAY_MS).toISOString(),
      runtimeMs,
      contentRating: pick(RATINGS),
      ratings: index % 6 === 3 ? {} : { community: Math.round((5 + random() * 4.5) * 10) / 10, critic: Math.round(40 + random() * 60) },
      genres: [pick(GENRES), pick(GENRES)].filter((genre, at, all) => all.indexOf(genre) === at),
      images: {},
      watch,
    };
    entries.push({ item: movie, libraryId: index % 4 === 3 ? 'kids' : 'films' });
    details.set(movie.key.externalId, detailOf(movie, pick));
  }

  for (let index = 0; index < showCount; index += 1) {
    const showKey = key(`show-${index}`);
    const title = `The ${pick(NOUNS)} ${pick(['Files', 'Diaries', 'Years', 'Club', 'House'])}`;
    const year = 1994 + Math.floor(random() * 32);
    const seasonCount = 1 + (index % 4);
    const showSeasons: Season[] = [];
    let watched = 0;
    let total = 0;
    // Every third show is being watched: its first episodes are played, the next one is in progress.
    const watching = index % 3 === 0 ? 1 + index : 0;
    for (let number = 1; number <= seasonCount; number += 1) {
      const seasonKey = key(`show-${index}-s${number}`);
      const count = 6 + ((index + number) % 5);
      const seasonEpisodes: Episode[] = [];
      for (let episodeNumber = 1; episodeNumber <= count; episodeNumber += 1) {
        total += 1;
        const played = total <= watching;
        const current = total === watching + 1 && watching > 0;
        if (played) watched += 1;
        const runtimeMs = (22 + ((index + episodeNumber) % 3) * 20) * 60_000;
        seasonEpisodes.push({
          type: 'episode',
          key: key(`show-${index}-s${number}-e${episodeNumber}`),
          title: `${pick(ADJECTIVES)} ${pick(NOUNS)}`,
          show: showKey,
          season: seasonKey,
          showTitle: title,
          seasonNumber: number,
          episodeNumber,
          airDate: `${year + number - 1}-${pad(1 + (episodeNumber % 12))}-${pad(1 + episodeNumber)}`,
          releaseDate: `${year + number - 1}-${pad(1 + (episodeNumber % 12))}-${pad(1 + episodeNumber)}`,
          runtimeMs,
          ratings: {},
          genres: [],
          images: {},
          watch: played
            ? { played: true, lastPlayedAt: lastPlayed() }
            : current
              ? { played: false, positionMs: Math.round(runtimeMs * 0.6), progress: 0.6, lastPlayedAt: lastPlayed() }
              : { played: false },
        });
      }
      const seasonWatched = seasonEpisodes.filter((episode) => episode.watch?.played).length;
      showSeasons.push({
        type: 'season',
        key: seasonKey,
        title: `Season ${number}`,
        show: showKey,
        showTitle: title,
        seasonNumber: number,
        episodeCount: count,
        ratings: {},
        genres: [],
        images: {},
        watch: progressOf(seasonWatched, count),
      });
      episodes.set(seasonKey.externalId, seasonEpisodes);
    }
    seasons.set(showKey.externalId, showSeasons);
    const show: Show = {
      type: 'show',
      key: showKey,
      title,
      releaseDate: `${year}-${pad(1 + (index % 12))}-01`,
      year,
      addedAt: new Date(EPOCH - index * 5 * DAY_MS).toISOString(),
      contentRating: pick(RATINGS),
      ratings: { community: Math.round((6 + random() * 3.5) * 10) / 10 },
      genres: [pick(GENRES)],
      images: {},
      status: index % 2 === 0 ? 'continuing' : 'ended',
      seasonCount,
      episodeCount: total,
      watch: progressOf(watched, total),
    };
    entries.push({ item: show, libraryId: index % 5 === 4 ? 'kids' : 'series' });
    details.set(show.key.externalId, detailOf(show, pick));
  }

  // Web video: two channels, each with a dozen videos, a few shorts and a playlist.
  const videos: (Movie | VideoChannel | VideoPlaylist)[] = [];
  const holds = new Map<string, Map<string, readonly MediaItem[]>>();
  for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
    const name = `${pick(ADJECTIVES)} ${pick(NOUNS)} TV`;
    const channelKey = key(`channel-${channelIndex}`);
    const made = (prefix: string, count: number, minutes: number): Movie[] =>
      Array.from({ length: count }, (_, at) => ({
        type: 'movie',
        key: key(`${prefix}-${channelIndex}-${at}`),
        title: `${pick(ADJECTIVES)} ${pick(NOUNS)}, part ${at + 1}`,
        addedAt: new Date(EPOCH - (channelIndex * 13 + at) * DAY_MS).toISOString(),
        releaseDate: new Date(EPOCH - (channelIndex * 13 + at) * DAY_MS).toISOString().slice(0, 10),
        year: 2026,
        runtimeMs: minutes * 60_000,
        ratings: {},
        genres: [name],
        images: {},
      }));
    const channelVideos = made('video', 12, 9 + channelIndex * 6);
    const shorts = made('short', 4, 1);
    const playlist: VideoPlaylist = {
      type: 'playlist',
      key: key(`playlist-${channelIndex}`),
      title: `The best of ${name}`,
      videoCount: 5,
      owner: { key: channelKey, name },
      ratings: {},
      genres: [name],
      images: {},
    };
    const channel: VideoChannel = {
      type: 'channel',
      key: channelKey,
      title: name,
      overview: `${name} makes up a new video every day, so a channel's page has something in each of its sections. It exists only on this device.`,
      followers: channelIndex === 0 ? 1_234_000 : 980,
      videoCount: channelVideos.length,
      ratings: {},
      genres: [],
      images: {},
    };
    videos.push(channel, ...channelVideos, playlist);
    holds.set(channelKey.externalId, new Map<string, readonly MediaItem[]>([['videos', channelVideos], ['shorts', shorts], ['playlists', [playlist]]]));
    holds.set(playlist.key.externalId, new Map<string, readonly MediaItem[]>([['videos', channelVideos.slice(0, 5)]]));
    details.set(channel.key.externalId, {
      item: channel,
      people: [],
      studios: [],
      sections: [
        { id: 'videos', label: 'Videos' },
        { id: 'shorts', label: 'Shorts' },
        { id: 'playlists', label: 'Playlists' },
      ],
    });
    details.set(playlist.key.externalId, { item: playlist, people: [], studios: [] });
    for (const video of channelVideos) {
      details.set(video.key.externalId, {
        item: { ...video, overview: `${video.title}, made up by ${name}.` },
        people: [],
        studios: [],
        creator: { key: channelKey, name, followers: channel.followers ?? 0 },
      });
    }
  }

  return { libraries: LIBRARIES, entries, seasons, episodes, details, videos, holds };
}

export function kindOf(item: MediaItem): ContentKind | undefined {
  if (item.type === 'movie') return 'movies';
  if (item.type === 'show') return 'shows';
  return undefined;
}

/** How many of a channel's videos one page of its section holds: small, so paging shows. */
export const CHILD_PAGE = 5;

function progressOf(watched: number, total: number): WatchStatus {
  if (watched === total) return { played: true };
  return watched === 0 ? { played: false, unplayedCount: total } : { played: false, progress: watched / total, unplayedCount: total - watched };
}

function detailOf(item: Movie | Show, pick: <T>(values: readonly T[]) => T): MediaDetail {
  return {
    item: { ...item, overview: `${item.title} is a story that exists only on this device, made up so every screen has something to show.` },
    tagline: 'Nothing here needs a network.',
    people: [
      { name: pick(NAMES), role: 'Lead', kind: 'actor' },
      { name: pick(NAMES), role: 'Support', kind: 'actor' },
      { name: pick(NAMES), kind: 'director' },
    ],
    studios: ['Mock Pictures'],
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// A linear congruential generator: small, and the same sequence everywhere.
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}
