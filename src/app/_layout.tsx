// Tamagui's web reset: without it browser defaults (button padding, margins)
// leak into components. CSS imports are ignored off the web.
import '@tamagui/core/reset.css';

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { ThemeRoot } from '@/components/theme-root';
import { ServicesProvider } from '@/composition/provider';
import { useSyncEffects } from '@/hooks/use-account';
import { useGate } from '@/hooks/use-session';

// Held until the boot decision is made, so the first screen shown is the right one.
void SplashScreen.preventAutoHideAsync();

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
 * the gate moves, the guards do the navigating. `(app)` comes first so it is
 * where a guard flip lands once the app is ready. It is reachable while the
 * app starts, too — behind the splash screen — so a link that opened the app
 * keeps its target instead of losing it to the boot screen.
 */
function RootStack() {
  const gate = useGate();
  const settled = gate.kind !== 'starting';
  useSyncEffects();

  useEffect(() => {
    if (settled) void SplashScreen.hideAsync();
  }, [settled]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={gate.kind === 'ready' || gate.kind === 'starting'}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="index" />
        <Stack.Screen name="who-is-watching" options={{ presentation: 'modal' }} />
        <Stack.Screen name="unlock/[userId]" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'failed'}>
        <Stack.Screen name="boot" />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'needs-account' || gate.kind === 'needs-first-user'}>
        <Stack.Screen name="welcome" />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'needs-user-selection'}>
        <Stack.Screen name="select-profile" />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'needs-user-unlock'}>
        <Stack.Screen name="locked" />
      </Stack.Protected>
    </Stack>
  );
}
