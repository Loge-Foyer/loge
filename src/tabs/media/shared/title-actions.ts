import type { MediaItem, PluginId } from '@loge/api';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';

import { playHref } from '@/components/media/item-link';
import { useServices } from '@/hooks/services-context';
import { useActiveUserId } from '@/hooks/use-session';

/** Where something stopped, if it did and is not finished. */
export function resumeAtOf(item: MediaItem | undefined): number | undefined {
  const at = item?.watch && !item.watch.played ? item.watch.positionMs : undefined;
  return at !== undefined && at > 0 ? at : undefined;
}

/**
 * What a title's buttons do: play — from where it stopped, from the start, or
 * with one player — and mark it watched or not, written here first and heard
 * by the source later.
 */
export function useTitleActions(item: MediaItem | undefined) {
  const userId = useActiveUserId();
  const { watch } = useServices();
  const mark = useMutation({
    mutationFn: (played: boolean) => {
      if (!item) throw new Error('Nothing to mark.');
      return watch.setPlayed(userId, item, played);
    },
    networkMode: 'always',
  });
  const play = (what: MediaItem, options: { readonly fromStart?: boolean; readonly player?: PluginId } = {}) => {
    const startMs = options.fromStart ? undefined : resumeAtOf(what);
    router.push(playHref(what.key, { ...(startMs ? { startMs } : {}), ...(options.player ? { player: options.player } : {}) }));
  };
  return { play, mark };
}
