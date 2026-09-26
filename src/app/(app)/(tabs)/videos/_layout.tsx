import { Stack } from 'expo-router';

import { tabRootOptions, tabStackOptions } from '@/components/stack-options';

export const unstable_settings = { anchor: 'index' };

export default function VideosStack() {
  return (
    <Stack screenOptions={tabStackOptions}>
      <Stack.Screen name="index" options={tabRootOptions('Videos')} />
    </Stack>
  );
}
