import { useLocalSearchParams } from 'expo-router';

import { MediaGrid } from '@/tabs/media';

export default function Browse() {
  const { rowId, kind, genre } = useLocalSearchParams<{ rowId: string; kind?: string; genre?: string }>();
  return <MediaGrid rowId={rowId} {...(kind ? { kind } : {})} {...(genre ? { genre } : {})} />;
}
