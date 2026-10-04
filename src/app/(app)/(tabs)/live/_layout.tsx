import { Stack } from 'expo-router';

import { fullScreenOptions, tabRootOptions, tabStackOptions } from '@/components/stack-options';

export const unstable_settings = { anchor: 'index' };

export default function LiveStack() {
  return (
    <Stack screenOptions={tabStackOptions}>
      <Stack.Screen name="index" options={tabRootOptions('Live')} />
      <Stack.Screen name="channel/[connectionId]/[channelId]" options={fullScreenOptions} />
    </Stack>
  );
}
