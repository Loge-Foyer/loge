import type { X } from '@tamagui/lucide-icons-2/icons/X';
import { Platform, Pressable } from 'react-native';
import { YStack } from 'tamagui';

import { px } from './density';
import { FOCUSED, useRemoteFocus } from './remote';

// From iOS 26 — and tvOS 26 — a header's buttons sit in the system's own
// glass, which follows light and dark; anywhere else a button over artwork
// needs a backdrop of its own to be seen.
export const SYSTEM_GLASS = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;
// A browser's header gives its right-hand buttons no margin of their own.
const EDGE = Platform.OS === 'web' ? 8 : 0;

/** A Lucide symbol, as every one of them is typed. */
export type HeaderIcon = typeof X;

/**
 * A round button over a picture, in the platform's own look where it can have
 * one: in a native header on iOS 26 the system's glass is the button, and it
 * draws only its symbol; anywhere else — an older iOS, Android, a browser, or
 * floating over a picture with no header — a dark translucent circle, which
 * reads over any picture.
 */
export function HeaderButton({
  icon: Icon,
  label,
  onPress,
  inHeader = false,
}: {
  icon: HeaderIcon;
  label: string;
  onPress: () => void;
  /** It sits in a native header, whose glass it can take. */
  inHeader?: boolean;
}) {
  const { focused, handlers } = useRemoteFocus();
  const glass = inHeader && SYSTEM_GLASS;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={{ marginRight: inHeader ? EDGE : 0 }}
      {...handlers}
    >
      {({ pressed }) => (
        <YStack
          width={px(36)}
          height={px(36)}
          rounded={999}
          items="center"
          justify="center"
          bg={glass ? 'transparent' : 'rgba(0, 0, 0, 0.55)'}
          opacity={pressed ? 0.7 : 1}
          {...(focused ? FOCUSED : {})}
        >
          <Icon size={px(20)} color={glass ? '$color12' : 'white'} />
        </YStack>
      )}
    </Pressable>
  );
}
