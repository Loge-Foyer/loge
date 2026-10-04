import { Stack } from 'expo-router';

import { tabRootOptions, tabStackOptions } from '@/components/stack-options';
import { MediaHeaderRight } from '@/tabs/media';

export const unstable_settings = { anchor: 'index' };

export default function MediaStack() {
  return (
    <Stack screenOptions={tabStackOptions}>
      <Stack.Screen name="index" options={tabRootOptions('Media', { right: <MediaHeaderRight /> })} />
    </Stack>
  );
}
