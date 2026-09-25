import { pluginId as toPluginId } from '@sc/api';
import { useLocalSearchParams } from 'expo-router';

import { NewConnectionScreen } from '@/screens/settings/connection';

export default function NewConnection() {
  const { pluginId } = useLocalSearchParams<{ pluginId: string }>();
  return <NewConnectionScreen pluginId={toPluginId(pluginId)} />;
}
