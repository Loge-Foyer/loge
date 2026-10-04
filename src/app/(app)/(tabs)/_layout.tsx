import { AppTabs } from '@/components/app-tabs';

// Media is where the app opens. Without an anchor expo-router picks the shortest
// route name, and a four-letter `live` would win.
export const unstable_settings = { anchor: 'media' };

/** The four tabs. The profile they belong to is provided, and keyed, by the `(app)` group around them. */
export default function TabsLayout() {
  return <AppTabs />;
}
