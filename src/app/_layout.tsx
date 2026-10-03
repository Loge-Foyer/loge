// Tamagui's web reset: without it browser defaults (button padding, margins)
// leak into components. CSS imports are ignored off the web.
import '@tamagui/core/reset.css';

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { ThemeRoot } from '@/components/theme-root';
import { ServicesProvider } from '@/composition/provider';
import { useSyncEffects } from '@/hooks/use-account';
import { useStartedAppSettings } from '@/hooks/use-app-settings';
import { useGate } from '@/hooks/use-session';

// Held until the boot decision is made, so the first screen shown is the right one.
void SplashScreen.preventAutoHideAsync();

// A guard flip replaces a root screen, and a native stack animates a replace
// as a push: each step from the splash to the first tab — through "Who's
// watching?", the PIN pad or Welcome — slid in from the right. They appear at
// once; the switcher's own modals, opened from inside the app, keep their
// slide.
const AT_ONCE = { animation: 'none' } as const;

export default function RootLayout() {
  return (
    <ServicesProvider>
      <ThemeRoot>
        <RootStack />
      </ThemeRoot>
    </ServicesProvider>
  );
}

/**
 * Every route sits behind exactly one guard, keyed on the session gate; when
 * the gate moves, the guards do the navigating. `index` comes first so it is
 * where a guard flip lands once the app is ready — after "Who's watching?",
 * the PIN pad or Welcome — and it opens the tab this device chose, as it
 * does at a cold start. `(app)` is reachable while the app starts, too —
 * behind the splash screen — so a link that opened the app keeps its target
 * instead of losing it to the boot screen.
 */
function RootStack() {
  const gate = useGate();
  // Once the gate has settled and this device's settings are read — or there
  // is nothing more to read: the first frame then has the scheme it keeps,
  // and `index` redirects at once, with no spinner between the splash and the
  // tab.
  const { known } = useStartedAppSettings();
  useSyncEffects();

  useEffect(() => {
    if (known) void SplashScreen.hideAsync();
  }, [known]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={gate.kind === 'ready' || gate.kind === 'starting'}>
        <Stack.Screen name="index" options={AT_ONCE} />
        <Stack.Screen name="(app)" options={AT_ONCE} />
        <Stack.Screen name="who-is-watching" options={{ presentation: 'modal' }} />
        <Stack.Screen name="unlock/[userId]" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'failed'}>
        <Stack.Screen name="boot" options={AT_ONCE} />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'needs-account' || gate.kind === 'needs-first-user'}>
        <Stack.Screen name="welcome" options={AT_ONCE} />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'needs-user-selection'}>
        <Stack.Screen name="select-profile" options={AT_ONCE} />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'needs-user-unlock'}>
        <Stack.Screen name="locked" options={AT_ONCE} />
      </Stack.Protected>
    </Stack>
  );
}
