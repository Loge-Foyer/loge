import { connectionId as toConnectionId } from '@sc/api';
import { useLocalSearchParams } from 'expo-router';

import { fromRouteId } from '@/components/media/item-link';
import { DetailScreen } from '@/screens/media/detail';

export default function Item() {
  const { connectionId, itemId, season } = useLocalSearchParams<{ connectionId: string; itemId: string; season?: string }>();
  return <DetailScreen connectionId={toConnectionId(connectionId)} itemId={fromRouteId(itemId)} {...(season ? { season: fromRouteId(season) } : {})} />;
}
