import type { ComponentProps, ReactNode } from 'react';
import type { Stack } from 'expo-router';
import { XStack } from 'tamagui';

import { ProfileButton } from './profile-button';
import { isTV } from './remote';

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
 * navigation bar already is the header, and on a TV the tab bar names the tab
 * — what sat beside the title is in the screen there.
 */
export function tabRootOptions(title: string, options: { right?: ReactNode } = {}): StackOptions {
  return {
    title,
    headerShown: !isWeb && !isTV,
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

/** A detail page: the header floats over the artwork — on a TV there is none, and Menu goes back. */
export const detailOptions: StackOptions = {
  headerShown: !isTV,
  headerTransparent: true,
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal',
  title: '',
};

/**
 * The player: the whole screen, no header, faded in over the tabs. On a TV it
 * is pushed rather than presented: tvOS puts a native modal outside React
 * Native's root view, where no control can ask for the focus — and the remote
 * needs play/pause to have it when the controls come up.
 */
export const playerOptions: StackOptions = {
  headerShown: false,
  presentation: isTV ? 'card' : 'fullScreenModal',
  animation: 'fade',
  gestureEnabled: false,
  // Black behind the picture in either scheme, so a turn or a fade shows no white edge.
  contentStyle: { backgroundColor: 'black' },
};

/**
 * Who is watching, and a profile's PIN: a modal on a phone. On a TV the whole
 * screen, pushed as the player is — a native modal there was a card in the
 * middle, outside React Native's root view, where the picker could not put
 * the focus on the profile in use.
 */
export const profileGateOptions: StackOptions = isTV ? { presentation: 'card', animation: 'fade' } : { presentation: 'modal' };

/**
 * A native sheet on iOS and Android, a plain page in a browser. What it shows
 * must be inline — a Tamagui portal would render behind the native sheet. A
 * TV has no sheets: it takes the whole screen, and Menu or Done closes it.
 */
export const sheetOptions: StackOptions = isTV
  ? { presentation: 'fullScreenModal', headerShown: false }
  : {
      presentation: 'formSheet',
      sheetAllowedDetents: [0.7, 1],
      sheetGrabberVisible: true,
      headerShown: false,
    };
