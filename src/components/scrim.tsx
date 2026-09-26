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
  const clear = solid.length === 7 ? `${solid}00` : 'transparent';
  const colors = from === 'bottom' ? ([clear, solid] as const) : ([solid, clear] as const);
  return (
    <LinearGradient
      colors={colors}
      locations={from === 'bottom' ? [1 - 0.65 * strength, 1] : [0, 0.65 * strength]}
      style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
    />
  );
}
