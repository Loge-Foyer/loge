import { connectionId as toConnectionId } from '@sc/api';
import { useLocalSearchParams } from 'expo-router';

import { PlayerScreen } from '@/screens/player';

export default function Play() {
  const { connectionId, itemId, start } = useLocalSearchParams<{ connectionId: string; itemId: string; start?: string }>();
  const startMs = start === undefined ? undefined : Number(start);
  return (
    <PlayerScreen
      connectionId={toConnectionId(connectionId)}
      itemId={itemId}
      {...(startMs !== undefined && Number.isFinite(startMs) && startMs > 0 ? { startMs } : {})}
    />
  );
}
