import type { ComponentProps, ReactNode } from 'react';
import type { Stack } from 'expo-router';
import { XStack } from 'tamagui';

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
 * it, and anything else the screen offers there. In a browser the top
 * navigation bar already is the header.
 */
export function tabRootOptions(title: string, options: { right?: ReactNode } = {}): StackOptions {
  return {
    title,
    headerShown: !isWeb,
    headerLargeTitleEnabled: true,
    headerRight: () => (
      <XStack gap="$3" items="center">
        {options.right}
        <ProfileButton />
      </XStack>
    ),
  };
}

/** A page pushed over the tabs: its own header, with a way back. */
export const fullScreenOptions: StackOptions = {
  headerShown: true,
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal',
};

/** A detail page: the header floats over the artwork. */
export const detailOptions: StackOptions = {
  headerShown: true,
  headerTransparent: true,
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal',
  title: '',
};

/** The player: the whole screen, no header, faded in over the tabs. */
export const playerOptions: StackOptions = {
  headerShown: false,
  presentation: 'fullScreenModal',
  animation: 'fade',
  gestureEnabled: false,
};

/**
 * A native sheet on iOS and Android, a plain page in a browser. What it shows
 * must be inline — a Tamagui portal would render behind the native sheet.
 */
export const sheetOptions: StackOptions = {
  presentation: 'formSheet',
  sheetAllowedDetents: [0.7, 1],
  sheetGrabberVisible: true,
  headerShown: false,
};
