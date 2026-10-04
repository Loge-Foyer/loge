import { X } from '@tamagui/lucide-icons-2/icons/X';
import { useRef } from 'react';
import { Modal, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SizableText, YStack } from 'tamagui';

import { Button } from './button';
import { GUTTER, px } from './density';
import { isTV, useRemoteFocus } from './remote';

const ROW = px(56);

export interface OverlayOption<T extends string> {
  readonly id: T;
  readonly label: string;
}

/**
 * A choice that takes the whole screen — a category, a season: the options in
 * large type, the chosen one in the words' colour and the rest grey, opened
 * where the choice in force is. React Native's own modal, which sits above a
 * native sheet and takes a remote's focus, and closes on Android's Back and an
 * Apple TV's Menu by itself. A round ✕ at its foot closes it where a finger
 * can press one; a remote's Menu does that on a TV.
 */
export function OverlayPicker<T extends string>({
  open,
  label,
  options,
  selected,
  onSelect,
  onClose,
}: {
  open: boolean;
  /** What the choice is, read aloud. */
  label: string;
  options: readonly OverlayOption<T>[];
  selected: T | undefined;
  onSelect: (id: T) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const at = Math.max(0, options.findIndex((option) => option.id === selected));
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <YStack flex={1} aria-label={label}>
        <YStack position="absolute" t={0} l={0} r={0} b={0} bg="$background" opacity={0.94} />
        <ScrollView
          ref={scroll}
          contentContainerStyle={{ paddingTop: insets.top + px(48), paddingBottom: insets.bottom + px(isTV ? 48 : 112), paddingHorizontal: GUTTER + px(16) }}
          // Opened where the choice in force is, a third of the way down.
          onLayout={() => scroll.current?.scrollTo({ y: Math.max(0, at * ROW - height / 3), animated: false })}
        >
          {options.map((option, index) => (
            <OverlayRow
              key={option.id}
              label={option.label}
              chosen={option.id === selected}
              preferred={index === at}
              onPress={() => {
                onSelect(option.id);
                onClose();
              }}
            />
          ))}
        </ScrollView>
        {isTV ? null : (
          <YStack position="absolute" l={0} r={0} b={insets.bottom + px(16)} items="center" pointerEvents="box-none">
            <Button
              circular
              size="$5"
              bg="$color12"
              pressStyle={{ bg: '$color11' }}
              icon={<X size={px(24)} color="$color1" />}
              aria-label="Close"
              onPress={onClose}
            />
          </YStack>
        )}
      </YStack>
    </Modal>
  );
}

function OverlayRow({ label, chosen, preferred, onPress }: { label: string; chosen: boolean; preferred: boolean; onPress: () => void }) {
  const { focused, handlers } = useRemoteFocus();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: chosen }}
      hasTVPreferredFocus={preferred}
      {...handlers}
    >
      {({ pressed }) => (
        // A remote's focus shows on a TV; a browser's own focus ring is enough elsewhere.
        <YStack height={ROW} justify="center" px="$3" rounded="$4" bg={isTV && focused ? '$accent4' : 'transparent'} opacity={pressed ? 0.7 : 1}>
          <SizableText size="$7" fontWeight={chosen ? '700' : '400'} color={chosen || (isTV && focused) ? '$color12' : '$color10'} numberOfLines={1}>
            {label}
          </SizableText>
        </YStack>
      )}
    </Pressable>
  );
}
