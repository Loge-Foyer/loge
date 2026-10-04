import type { Episode, MediaItem, MediaVersion, Person } from '@loge/api';

import { episodeCode, formatRuntime, hdrName, resolutionName, spatialName, timeLeft } from '@/components/labels';

/** The best of a title's versions: the one with the most lines. */
function bestOf(versions: readonly MediaVersion[] | undefined): MediaVersion | undefined {
  let best: MediaVersion | undefined;
  for (const version of versions ?? []) {
    if (!best || (version.video?.height ?? 0) > (best.video?.height ?? 0)) best = version;
  }
  return best;
}

/** "4K", "HD" or "SD", as the best version says — nothing where the source did not say. */
export function qualityOf(versions: readonly MediaVersion[] | undefined): string | undefined {
  const video = bestOf(versions)?.video;
  const name = resolutionName(video?.height, video?.width);
  if (name === undefined) return undefined;
  if (name === '4K') return '4K';
  return (video?.height ?? 0) >= 700 || (video?.width ?? 0) >= 1200 ? 'HD' : 'SD';
}

/** How it looks and sounds at its best, for a TV's page: "4K", "Dolby Vision", "Dolby Atmos". */
export function qualityBadges(versions: readonly MediaVersion[] | undefined): readonly string[] {
  const best = bestOf(versions);
  const spatial = best?.audio.find((track) => track.spatial !== undefined)?.spatial;
  return [
    qualityOf(versions),
    best?.video?.hdr === undefined ? undefined : hdrName(best.video.hdr),
    spatial === undefined ? undefined : spatialName(spatial),
  ].filter((badge): badge is string => badge !== undefined);
}

/** A title's facts: its year or years, then how long it runs or how many seasons it has. */
export function factsOf(item: MediaItem): readonly string[] {
  const years =
    item.year === undefined ? undefined : item.type === 'show' && item.endYear && item.endYear !== item.year ? `${item.year}–${item.endYear}` : String(item.year);
  const length =
    item.type === 'show'
      ? item.seasonCount === undefined
        ? undefined
        : `${item.seasonCount} ${item.seasonCount === 1 ? 'season' : 'seasons'}`
      : item.runtimeMs
        ? formatRuntime(item.runtimeMs)
        : undefined;
  return [years, length].filter((fact): fact is string => fact !== undefined);
}

/** Who is in it, and who made it: the actors, then the directors — or, for a series with none, its writers. */
export function creditsOf(people: readonly Person[]): { readonly cast: readonly string[]; readonly makers: readonly string[]; readonly makersLabel: string } {
  const cast = people.filter((person) => person.kind === 'actor').map((person) => person.name);
  const directors = people.filter((person) => person.kind === 'director').map((person) => person.name);
  if (directors.length > 0) return { cast, makers: directors, makersLabel: directors.length === 1 ? 'Director' : 'Directors' };
  return { cast, makers: people.filter((person) => person.kind === 'writer').map((person) => person.name), makersLabel: 'Creators' };
}

/** "23 min left" — only for something part-way through: not for what is not begun, nor for what is finished. */
export function leftOf(item: MediaItem): string | undefined {
  const at = item.watch && !item.watch.played ? item.watch.positionMs : undefined;
  return at !== undefined && at > 0 ? timeLeft(item) : undefined;
}

/** How long an episode runs, or how long is left of one begun. */
export function episodeLength(episode: Episode): string | undefined {
  return leftOf(episode) ?? (episode.runtimeMs ? formatRuntime(episode.runtimeMs) : undefined);
}

/**
 * The two lines a TV's row shows under the card the remote is on: an episode
 * by its code and name, and how long is left; anything else by its facts and
 * what it is about in a few words — its genres.
 */
export function tvInfoLines(item: MediaItem): readonly [string, string] {
  if (item.type === 'episode') {
    return [[episodeCode(item), item.title].filter(Boolean).join(' · '), episodeLength(item) ?? ''];
  }
  const left = leftOf(item);
  return [[item.title, ...factsOf(item)].join(' · '), left ?? item.genres.slice(0, 3).join(' · ')];
}

/** The season a series' page opens on: the first with something not watched, else the first. */
export function seasonToOpen(seasons: readonly MediaItem[], chosen?: string): MediaItem | undefined {
  return (
    seasons.find((season) => season.key.externalId === chosen) ??
    seasons.find((season) => season.watch !== undefined && !season.watch.played) ??
    seasons[0]
  );
}

/**
 * What Play plays of a season: the episode someone is part-way through, else
 * the first not watched, else — watched through — the first.
 */
export function upNextOf(episodes: readonly Episode[]): Episode | undefined {
  return (
    episodes.find((episode) => !episode.watch?.played && (episode.watch?.positionMs ?? 0) > 0) ??
    episodes.find((episode) => !episode.watch?.played) ??
    episodes[0]
  );
}
