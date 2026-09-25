import { userId as toUserId } from '@sc/api';
import { useLocalSearchParams } from 'expo-router';

import { UnlockScreen } from '@/screens/unlock';

export default function Unlock() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  return <UnlockScreen userId={toUserId(userId)} mode="switch" />;
}
