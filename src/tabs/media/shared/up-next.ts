import type { Episode, MediaItem, Show } from '@loge/api';

import { useKeptWatch } from '@/hooks/use-kept-watch';
import { useChildren, useContinueWatching } from '@/hooks/use-media';

import { seasonToOpen, upNextOf } from './title-meta';

const isEpisode = (item: MediaItem): item is Episode => item.type === 'episode';

/**
 * The episode Play plays for a series: one of it in Continue Watching wins —
 * that is where someone stopped — else what is next in the season its page
 * opens on.
 */
export function useUpNext(show: Show | undefined): Episode | undefined {
  const continuing = useContinueWatching(show !== undefined);
  const seasons = useChildren(show);
  const season = seasonToOpen(seasons.data?.items ?? []);
  const episodes = useChildren(season);
  const withKept = useKeptWatch(episodes.data?.items ?? []);
  if (!show) return undefined;
  const resuming = (continuing.data?.items ?? [])
    .filter(isEpisode)
    .find((episode) => episode.show.connectionId === show.key.connectionId && episode.show.externalId === show.key.externalId);
  return resuming ?? upNextOf((episodes.data?.items ?? []).map(withKept).filter(isEpisode));
}
