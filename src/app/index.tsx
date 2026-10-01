import { Redirect } from 'expo-router';

import { useAppSettings } from '@/hooks/use-app-settings';
import { useGate } from '@/hooks/use-session';
import { BootScreen } from '@/screens/boot';

/**
 * Where the app opens: the tab this device chose in Settings → App, Media
 * unless it chose another. Reached at a cold start, and when the gate turns
 * ready after a profile was picked; a link that opened the app goes straight
 * to its own page instead. Settings are read only once the database is ready.
 */
export default function Index() {
  const ready = useGate().kind === 'ready';
  const settings = useAppSettings({ enabled: ready });
  if (!ready || !settings.data) return <BootScreen />;
  return <Redirect href={`/${settings.data.openOn}`} />;
}
