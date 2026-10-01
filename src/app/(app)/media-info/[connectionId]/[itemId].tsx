import { useLocalSearchParams } from 'expo-router';

import { fromRouteId } from '@/components/media/item-link';
import { MediaInfoScreen } from '@/screens/media/media-info';

export default function MediaInfo() {
  const { connectionId, itemId } = useLocalSearchParams<{ connectionId: string; itemId: string }>();
  return <MediaInfoScreen connectionId={connectionId} itemId={fromRouteId(itemId)} />;
}
