import { userId as toUserId } from '@loge/api';
import { useLocalSearchParams } from 'expo-router';

import { ProfileScreen } from '@/screens/settings/profile';

export default function Profile() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  return <ProfileScreen userId={toUserId(userId)} />;
}
