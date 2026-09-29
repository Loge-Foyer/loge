import { Stack } from 'expo-router';

import { tabRootOptions, tabStackOptions } from '@/components/stack-options';

export const unstable_settings = { anchor: 'index' };

export default function SettingsStack() {
  return (
    <Stack screenOptions={tabStackOptions}>
      <Stack.Screen name="index" options={tabRootOptions('Settings')} />
      <Stack.Screen name="account/index" options={{ title: 'Account' }} />
      <Stack.Screen name="pin" options={{ title: 'PIN lock' }} />
      <Stack.Screen name="profiles/index" options={{ title: 'Profiles' }} />
    </Stack>
  );
}
