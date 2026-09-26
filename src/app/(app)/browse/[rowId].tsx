import { useLocalSearchParams } from 'expo-router';

import { BrowseScreen } from '@/screens/media/browse';

export default function Browse() {
  const { rowId } = useLocalSearchParams<{ rowId: string }>();
  return <BrowseScreen rowId={rowId} />;
}
