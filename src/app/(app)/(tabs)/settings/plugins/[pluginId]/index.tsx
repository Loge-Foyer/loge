import { pluginId as toPluginId } from '@sc/api';
import { useLocalSearchParams } from 'expo-router';

import { PluginScreen } from '@/screens/settings/plugin';

export default function Plugin() {
  const { pluginId } = useLocalSearchParams<{ pluginId: string }>();
  return <PluginScreen pluginId={toPluginId(pluginId)} />;
}
