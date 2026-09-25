import type { ComponentProps } from 'react';
import type { Stack } from 'expo-router';

import { ProfileButton } from './profile-button';

// The object form of the options, not the per-route callback.
type StackOptions = Exclude<
  NonNullable<ComponentProps<typeof Stack>['screenOptions']>,
  (...args: never[]) => unknown
>;

const isWeb = process.env.EXPO_OS === 'web';

export const tabStackOptions: StackOptions = {
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal',
};

/**
 * A tab's first screen: a large native title with the profile switcher beside
 * it. In a browser the top navigation bar already is the header.
 */
export function tabRootOptions(title: string): StackOptions {
  return {
    title,
    headerShown: !isWeb,
    headerLargeTitle: true,
    headerRight: () => <ProfileButton />,
  };
}
