import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';
import { useTheme } from 'tamagui';

import { clearOf } from './colour';

// Down the page is the gradient's own direction; from a side it runs across.
const ACROSS = { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } } as const;

/**
 * A fade from clear to the page background, so text laid over artwork stays
 * readable — the page's colour on the side named, gone 65% of the way across
 * at full strength. The gradient is drawn natively, so it takes resolved
 * colours.
 */
export function Scrim({ from = 'bottom', strength = 1 }: { from?: 'top' | 'bottom' | 'left' | 'right'; strength?: number }) {
  const theme = useTheme();
  const solid = String(theme.background.val);
  const clear = clearOf(solid);
  const leading = from === 'top' || from === 'left';
  return (
    <LinearGradient
      colors={leading ? ([solid, clear] as const) : ([clear, solid] as const)}
      locations={leading ? [0, 0.65 * strength] : [1 - 0.65 * strength, 1]}
      {...(from === 'left' || from === 'right' ? ACROSS : {})}
      style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
    />
  );
}
