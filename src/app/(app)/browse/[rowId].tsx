import { useLocalSearchParams } from 'expo-router';

import { MediaGrid } from '@/tabs/media';

export default function Browse() {
  const { rowId } = useLocalSearchParams<{ rowId: string }>();
  return <MediaGrid rowId={rowId} />;
}
