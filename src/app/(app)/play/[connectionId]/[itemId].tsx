import { connectionId as toConnectionId, pluginId } from '@loge/api';
import { useLocalSearchParams } from 'expo-router';

import { fromRouteId } from '@/components/media/item-link';
import { PlayerScreen } from '@/screens/player';

export default function Play() {
  const { connectionId, itemId, start, live, title, group, player } = useLocalSearchParams<{
    connectionId: string;
    itemId: string;
    start?: string;
    live?: string;
    title?: string;
    group?: string;
    /** "Play with…": a player's id. */
    player?: string;
  }>();
  const startMs = start === undefined ? undefined : Number(start);
  return (
    <PlayerScreen
      connectionId={toConnectionId(connectionId)}
      itemId={fromRouteId(itemId)}
      {...(startMs !== undefined && Number.isFinite(startMs) && startMs > 0 ? { startMs } : {})}
      {...(live === '1' ? { live: { title: title ?? '', ...(group ? { group: fromRouteId(group) } : {}) } } : {})}
      {...(player ? { player: pluginId(player) } : {})}
    />
  );
}
