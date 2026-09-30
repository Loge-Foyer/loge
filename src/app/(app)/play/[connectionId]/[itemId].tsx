import { connectionId as toConnectionId, pluginId } from '@sc/api';
import { useLocalSearchParams } from 'expo-router';

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
      itemId={itemId}
      {...(startMs !== undefined && Number.isFinite(startMs) && startMs > 0 ? { startMs } : {})}
      {...(live === '1' ? { live: { title: title ?? '', ...(group ? { group } : {}) } } : {})}
      {...(player ? { player: pluginId(player) } : {})}
    />
  );
}
