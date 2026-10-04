import { useLocalSearchParams } from 'expo-router';

import { CustomizeHome as CustomizeHomeScreen } from '@/tabs/media';

export default function CustomizeHome() {
  const { row } = useLocalSearchParams<{ row?: string }>();
  return <CustomizeHomeScreen {...(row ? { rowId: row } : {})} />;
}
