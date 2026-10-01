import { SizableText, Switch, XStack, useTheme } from 'tamagui';

import { FOCUSED, isTV, Remote } from '@/components/remote';

/**
 * The platform's own switch on iOS and Android, Tamagui's in a browser — in
 * the app's accent either way.
 */
export function AppSwitch({
  checked,
  onCheckedChange,
  disabled = false,
  id,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
}) {
  const theme = useTheme();
  // UIKit has no switch on tvOS, and a remote cannot slide one: On and Off,
  // pressed to change.
  if (isTV) {
    return (
      <Remote onPress={() => onCheckedChange(!checked)} disabled={disabled}>
        {(focused) => (
          <XStack
            px="$3"
            py="$1.5"
            rounded="$10"
            bg={checked ? '$accentBackground' : '$color4'}
            opacity={disabled ? 0.5 : 1}
            {...(label ? { 'aria-label': label } : {})}
            {...(focused ? FOCUSED : {})}
          >
            <SizableText size="$3" fontWeight="600" color={checked ? '$accentColor' : '$color11'}>
              {checked ? 'On' : 'Off'}
            </SizableText>
          </XStack>
        )}
      </Remote>
    );
  }
  const accent = String(theme.accentBackground.val);
  // iOS keeps its white thumb; Material colours the thumb as well as the track.
  const colours =
    process.env.EXPO_OS === 'android'
      ? {
          trackColor: { false: String(theme.color6.val), true: String(theme.accent7.val) },
          thumbColor: checked ? accent : String(theme.color11.val),
        }
      : { trackColor: { true: accent } };
  // The platform's switch takes no aria-label: a screen reader hears this instead.
  const nativeProps = { ...colours, ...(label ? { accessibilityLabel: label } : {}) };
  return (
    <Switch
      size="$3"
      native="mobile"
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      activeStyle={{ backgroundColor: '$accentBackground' }}
      nativeProps={nativeProps}
      {...(id ? { id } : {})}
      {...(label ? { 'aria-label': label } : {})}
    >
      <Switch.Thumb transition="quick" />
    </Switch>
  );
}
