import type { ComponentProps } from 'react';
import { AlertDialog, Button, XStack, YStack } from 'tamagui';

/**
 * A destructive action behind a confirmation. `native` makes it the system
 * alert on iOS and Android; the browser gets Tamagui's dialog.
 */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled,
  icon,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  icon?: NonNullable<ComponentProps<typeof Button>['icon']>;
}) {
  return (
    <AlertDialog native>
      <AlertDialog.Trigger asChild>
        <Button theme="red" disabled={disabled ?? false} opacity={disabled ? 0.5 : 1} {...(icon ? { icon } : {})}>
          {label}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay key="overlay" bg="$shadowColor" enterStyle={{ opacity: 0 }} exitStyle={{ opacity: 0 }} />
        <AlertDialog.Content key="content" bordered elevate maxW={420} p="$5">
          <YStack gap="$4">
            <AlertDialog.Title size="$7">{title}</AlertDialog.Title>
            <AlertDialog.Description>{description}</AlertDialog.Description>
            <XStack gap="$3" justify="flex-end">
              <AlertDialog.Cancel asChild>
                <Button>Cancel</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button theme="red" onPress={onConfirm}>
                  {confirmLabel}
                </Button>
              </AlertDialog.Action>
            </XStack>
          </YStack>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  );
}
