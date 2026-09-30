import { Stack } from 'expo-router';

import { detailOptions, fullScreenOptions, playerOptions, sheetOptions } from '@/components/stack-options';
import { useMediaEffects } from '@/hooks/use-media';
import { ActiveUserContext, useGate } from '@/hooks/use-session';
import { BootScreen } from '@/screens/boot';

// A deep link straight to a full-screen page still has the tabs to go back to.
export const unstable_settings = { anchor: '(tabs)' };

/**
 * Everything a signed-in profile can reach: the tabs, and the pages pushed
 * over them. Keyed by the profile, so switching remounts all of it and no
 * screen of the previous profile survives the switch.
 */
export default function AppLayout() {
  const gate = useGate();
  // Still starting: the route a link asked for waits here, under the splash.
  if (gate.kind !== 'ready') return <BootScreen />;
  return (
    <ActiveUserContext key={gate.userId} value={gate.userId}>
      <MediaEffects />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="browse/[rowId]" options={fullScreenOptions} />
        <Stack.Screen name="item/[connectionId]/[itemId]" options={detailOptions} />
        <Stack.Screen name="customize-home" options={sheetOptions} />
        <Stack.Screen name="play/[connectionId]/[itemId]" options={playerOptions} />
      </Stack>
    </ActiveUserContext>
  );
}

function MediaEffects() {
  useMediaEffects();
  return null;
}
