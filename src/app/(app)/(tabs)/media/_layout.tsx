import { Stack } from 'expo-router';

import { CustomizeButton } from '@/components/customize-button';
import { tabRootOptions, tabStackOptions } from '@/components/stack-options';

export const unstable_settings = { anchor: 'index' };

export default function MediaStack() {
  return (
    <Stack screenOptions={tabStackOptions}>
      <Stack.Screen name="index" options={tabRootOptions('Media', { right: <CustomizeButton /> })} />
    </Stack>
  );
}
