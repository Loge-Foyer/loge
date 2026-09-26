import { useLocalSearchParams } from 'expo-router';

import { CustomizeHomeScreen } from '@/screens/media/customize-home';

export default function CustomizeHome() {
  const { row } = useLocalSearchParams<{ row?: string }>();
  return <CustomizeHomeScreen {...(row ? { rowId: row } : {})} />;
}
