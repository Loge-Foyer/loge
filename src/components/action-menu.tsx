import { useEffect, useEffectEvent } from 'react';
import { Alert } from 'react-native';
import { AlertDialog, XStack, YStack } from 'tamagui';

import { Button } from '@/components/button';
import { px } from '@/components/density';

const isWeb = process.env.EXPO_OS === 'web';

export interface MenuAction {
  readonly label: string;
  readonly onPress: () => void;
}

/**
 * The few things to do with something, offered by a long press — or, with a
 * remote, a held select. The system's own alert on iOS, Android and tvOS,
 * which the remote drives and which sits above everything, native sheets
 * included; Tamagui's dialog in a browser, which has no such alert.
 */
export function ActionMenu({
  title,
  actions,
  open,
  onClose,
}: {
  title: string;
  actions: readonly MenuAction[];
  open: boolean;
  onClose: () => void;
}) {
  // Shown once each time it opens, with what it offers then: a new render of
  // the screen behind it must not put up a second.
  const show = useEffectEvent(() =>
    Alert.alert(
      title,
      undefined,
      [
        ...actions.map((action) => ({
          text: action.label,
          onPress: () => {
            onClose();
            action.onPress();
          },
        })),
        { text: 'Cancel', style: 'cancel' as const, onPress: onClose },
      ],
      // Android also lets the alert go with a tap beside it, or Back.
      { cancelable: true, onDismiss: onClose },
    ),
  );
  useEffect(() => {
    if (open && !isWeb) show();
  }, [open]);

  if (!isWeb) return null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay key="overlay" bg="$shadowColor" enterStyle={{ opacity: 0 }} exitStyle={{ opacity: 0 }} />
        <AlertDialog.Content key="content" bordered elevate maxW={px(420)} p="$5">
          <YStack gap="$4">
            <AlertDialog.Title size="$7">{title}</AlertDialog.Title>
            <AlertDialog.Description size="$3" color="$color10">
              What to do with it
            </AlertDialog.Description>
            <XStack gap="$3" justify="flex-end" flexWrap="wrap">
              <AlertDialog.Cancel asChild>
                <Button>Cancel</Button>
              </AlertDialog.Cancel>
              {actions.map((action) => (
                <AlertDialog.Action
                  key={action.label}
                  asChild
                  onPress={() => {
                    onClose();
                    action.onPress();
                  }}
                >
                  <Button>{action.label}</Button>
                </AlertDialog.Action>
              ))}
            </XStack>
          </YStack>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  );
}
