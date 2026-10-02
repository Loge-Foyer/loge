import { connectionId as toConnectionId } from '@loge/api';
import { useLocalSearchParams } from 'expo-router';

import { EditConnectionScreen } from '@/screens/settings/connection';

export default function EditConnection() {
  const { connectionId } = useLocalSearchParams<{ connectionId: string }>();
  return <EditConnectionScreen connectionId={toConnectionId(connectionId)} />;
}
