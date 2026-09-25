import { Switch, useTheme } from 'tamagui';

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
  const accent = String(theme.accentBackground.val);
  // iOS keeps its white thumb; Material colours the thumb as well as the track.
  const nativeProps =
    process.env.EXPO_OS === 'android'
      ? {
          trackColor: { false: String(theme.color6.val), true: String(theme.accent7.val) },
          thumbColor: checked ? accent : String(theme.color11.val),
        }
      : { trackColor: { true: accent } };
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
