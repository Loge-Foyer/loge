// Tamagui's web reset: without it browser defaults (button padding, margins)
// leak into components. CSS imports are ignored off the web.
import '@tamagui/core/reset.css';

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { ThemeRoot } from '@/components/theme-root';
import { ServicesProvider } from '@/composition/provider';
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
 * the gate moves, the guards do the navigating. `(tabs)` comes first so it is
 * where a guard flip lands once the app is ready.
 */
function RootStack() {
  const gate = useGate();
  const settled = gate.kind !== 'starting';

  useEffect(() => {
    if (settled) void SplashScreen.hideAsync();
  }, [settled]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={gate.kind === 'ready'}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="index" />
        <Stack.Screen name="who-is-watching" options={{ presentation: 'modal' }} />
        <Stack.Screen name="unlock/[userId]" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'starting' || gate.kind === 'failed'}>
        <Stack.Screen name="boot" />
      </Stack.Protected>
      <Stack.Protected guard={gate.kind === 'needs-first-user'}>
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
