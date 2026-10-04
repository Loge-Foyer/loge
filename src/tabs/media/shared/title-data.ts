import type { GlobalMediaKey, MediaCapability, MediaItem } from '@loge/api';

import { useDownloadBudget } from '@/hooks/use-downloads';
import { useKeptWatch } from '@/hooks/use-kept-watch';
import { useItem } from '@/hooks/use-media';
import { usePlayers } from '@/hooks/use-players';
import { useSources } from '@/hooks/use-sources';

/**
 * A title's page, and what its source lets it do — the same for a phone's
 * sheet and a TV's page: whether it plays, whose watch state it shows, what
 * can be kept, and the players that can play it here.
 */
export function useTitle(key: GlobalMediaKey) {
  const detail = useItem(key);
  const { data: sources = [] } = useSources();
  const source = sources.find((candidate) => candidate.connection.id === key.connectionId);
  const capabilities = source?.effective.media?.capabilities;
  const can = (capability: MediaCapability) => capabilities?.has(capability) ?? false;
  const withKept = useKeptWatch(detail.data ? [detail.data.detail.item] : []);
  const { data: players = [] } = usePlayers();
  const { data: budget } = useDownloadBudget();
  const canPlay = can('playback');
  // A browser or a TV has nowhere to keep a copy.
  const canKeep = can('downloads') && budget?.limitBytes !== 0;
  return {
    detail: detail.data ? { ...detail.data.detail, item: withKept(detail.data.detail.item) } : undefined,
    sourceError: detail.data?.sourceError,
    isPending: detail.isPending,
    error: detail.error,
    /** Whoever keeps it: the source, or the app for one that keeps none. */
    showWatch: source?.watch !== undefined,
    canPlay,
    /** The app takes the mark itself where it keeps watch status; a source that keeps its own hears it later. */
    canMarkWatched: source?.watch === 'app' || can('watchStateWrite'),
    /** Only a single playable thing is worth keeping — a series is its episodes. */
    keepable: (item: MediaItem) => canKeep && (item.type === 'movie' || item.type === 'episode'),
    offersChoices: can('downloadOptions'),
    /** The players that are on and can play here — "Play with…" only when there is more than one. */
    players: players.filter((player) => player.enabled && player.playsHere),
  };
}
