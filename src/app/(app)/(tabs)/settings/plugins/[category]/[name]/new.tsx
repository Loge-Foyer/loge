import { useLocalSearchParams } from 'expo-router';

import { NewConnectionScreen } from '@/screens/settings/connection';
import { UnknownPlugin } from '@/screens/settings/plugin';
import { pluginParam } from '@/screens/settings/plugin-route';

export default function NewConnection() {
  const { category, name } = useLocalSearchParams<{ category: string; name: string }>();
  const id = pluginParam(category, name);
  return id ? <NewConnectionScreen pluginId={id} /> : <UnknownPlugin />;
}
