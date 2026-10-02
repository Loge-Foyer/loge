import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';
import { useTheme } from 'tamagui';

/**
 * A fade from clear to the page background, so text laid over artwork stays
 * readable. The gradient is drawn natively, so it takes resolved colours.
 */
export function Scrim({ from = 'bottom', strength = 1 }: { from?: 'top' | 'bottom'; strength?: number }) {
  const theme = useTheme();
  const solid = String(theme.background.val);
  const clear = clearOf(solid);
  const colors = from === 'bottom' ? ([clear, solid] as const) : ([solid, clear] as const);
  return (
    <LinearGradient
      colors={colors}
      locations={from === 'bottom' ? [1 - 0.65 * strength, 1] : [0, 0.65 * strength]}
      style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
    />
  );
}

/**
 * The same colour with none of it showing. A native gradient interpolates
 * each channel, so fading from `transparent` — clear black — darkens the
 * middle of the fade; the theme's colours arrive as `hsla()`, not hex.
 */
function clearOf(colour: string): string {
  if (/^#[0-9a-f]{6}$/i.test(colour)) return `${colour}00`;
  const match = /^(rgb|hsl)a?\(([^)]*)\)$/i.exec(colour);
  const kind = match?.[1];
  const channels = match?.[2]?.split(',').slice(0, 3).map((part) => part.trim());
  if (kind === undefined || channels?.length !== 3) return 'transparent';
  return `${kind.toLowerCase()}a(${channels.join(', ')}, 0)`;
}
