import { useLocalSearchParams } from 'expo-router';

import { PluginScreen, UnknownPlugin } from '@/screens/settings/plugin';
import { pluginParam } from '@/screens/settings/plugin-route';

export default function Plugin() {
  const { category, name } = useLocalSearchParams<{ category: string; name: string }>();
  const id = pluginParam(category, name);
  return id ? <PluginScreen pluginId={id} /> : <UnknownPlugin />;
}
