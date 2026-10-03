import { Check } from '@tamagui/lucide-icons-2/icons/Check';
import { ChevronLeft } from '@tamagui/lucide-icons-2/icons/ChevronLeft';
import { ChevronRight } from '@tamagui/lucide-icons-2/icons/ChevronRight';
import { Ellipsis } from '@tamagui/lucide-icons-2/icons/Ellipsis';
import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SizableText, XStack, YStack } from 'tamagui';

import { GUTTER, px } from './density';
import { FOCUSED, useRemoteFocus } from './remote';

// From iOS 26 — and tvOS 26 — a header's buttons sit in the system's own
// glass, which follows light and dark; anywhere else the "⋯" over artwork
// needs a backdrop of its own to be seen.
const SYSTEM_GLASS = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;
// A browser's header gives its right-hand buttons no margin of their own.
const EDGE = Platform.OS === 'web' ? 8 : 0;

/** The "⋯" a page keeps its lesser actions behind. */
export function MoreButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { focused, handlers } = useRemoteFocus();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={{ marginRight: EDGE }} {...handlers}>
      {({ pressed }) => (
        <YStack
          width={px(36)}
          height={px(36)}
          rounded={999}
          items="center"
          justify="center"
          bg={SYSTEM_GLASS ? 'transparent' : 'rgba(0, 0, 0, 0.55)'}
          opacity={pressed ? 0.7 : 1}
          {...(focused ? FOCUSED : {})}
        >
          <Ellipsis size={px(20)} color={SYSTEM_GLASS ? '$color12' : 'white'} />
        </YStack>
      )}
    </Pressable>
  );
}

/**
 * A menu floating below the top right of the screen, over a dimmed page, with
 * pages of its own — the players, the lists — rather than a second dialog.
 *
 * It is React Native's own modal, which sits above every native screen and
 * sheet and takes a remote's focus with it. Tamagui's popover renders through
 * a portal, which a native screen can cover, and the system's alert takes no
 * more than three buttons on Android.
 */
export function Menu({
  open,
  label,
  onClose,
  at,
  children,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  /** Where its top left goes, in the window — beside what opened it. Absent: below the top right. */
  at?: { readonly x: number; readonly y: number };
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const cardWidth = Math.min(px(300), width - 2 * GUTTER);
  const place = at
    ? { t: Math.min(at.y, height * 0.3), l: Math.max(GUTTER, Math.min(at.x, width - GUTTER - cardWidth)) }
    : { t: insets.top + px(52), r: GUTTER };
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}
      statusBarTranslucent
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close the menu" focusable={false}>
        <YStack flex={1} bg="rgba(0, 0, 0, 0.4)" />
      </Pressable>
      <YStack
        position="absolute"
        {...place}
        width={cardWidth}
        maxH={height * 0.7}
        bg="$color2"
        rounded="$6"
        borderWidth={1}
        borderColor="$color4"
        overflow="hidden"
        aria-label={label}
      >
        <ScrollView contentContainerStyle={{ paddingVertical: px(6) }}>{children}</ScrollView>
      </YStack>
    </Modal>
  );
}

/** One thing to do. `more` opens a page of choices; `selected` marks the choice in force. */
export function MenuRow({
  icon,
  label,
  detail,
  more = false,
  selected = false,
  disabled = false,
  preferred = false,
  onPress,
}: {
  icon?: ReactNode;
  label: string;
  detail?: string;
  more?: boolean;
  selected?: boolean;
  disabled?: boolean;
  /** On a TV: where the focus starts when the menu or its page opens. */
  preferred?: boolean;
  onPress?: () => void;
}) {
  const { focused, handlers } = useRemoteFocus();
  return (
    <Pressable
      {...(onPress ? { onPress } : {})}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ disabled: disabled || !onPress, selected }}
      hasTVPreferredFocus={preferred}
      {...handlers}
    >
      {({ pressed }) => (
        <XStack
          px="$4"
          py="$3"
          gap="$3"
          items="center"
          bg={focused ? '$accent4' : pressed ? '$color4' : 'transparent'}
          opacity={disabled ? 0.5 : 1}
        >
          {icon ? (
            <YStack width={px(22)} items="center">
              {icon}
            </YStack>
          ) : null}
          <YStack flex={1} gap="$0.5">
            <SizableText size="$4" color={focused ? '$accent11' : '$color12'} numberOfLines={2}>
              {label}
            </SizableText>
            {detail ? (
              <SizableText size="$2" color="$color10" numberOfLines={2}>
                {detail}
              </SizableText>
            ) : null}
          </YStack>
          {selected ? <Check size={px(18)} color="$accent10" /> : null}
          {more ? <ChevronRight size={px(18)} color="$color10" /> : null}
        </XStack>
      )}
    </Pressable>
  );
}

/** A page's title, with the way back to the menu it came from. */
export function MenuHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <YStack borderBottomWidth={1} borderColor="$color4" mb="$1">
      <MenuRow icon={<ChevronLeft size={px(18)} color="$color11" />} label={title} onPress={onBack} />
    </YStack>
  );
}

/** A line that is not a choice: the server being asked, or nothing to choose. */
export function MenuNote({ children }: { children: string }) {
  return (
    <SizableText px="$4" py="$3" size="$3" color="$color10">
      {children}
    </SizableText>
  );
}
