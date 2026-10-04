import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, useThemeName } from 'tamagui';

import type { GlowColour } from '@/services/ports';

import { clearOf, withAlpha } from './colour';

/**
 * A wash of colour from the top of a page down into it — Media's home, on a
 * phone and in a browser. Half the tint on black, less on white, where the
 * same wash reads as a stain; it ends in the page's own colour, clear, so no
 * grey band shows where it meets the page. Drawn natively, so it takes
 * resolved colours.
 */
export function Glow({ colour, height }: { colour: GlowColour; height: number }) {
  const theme = useTheme();
  const dark = useThemeName().startsWith('dark');
  const tint = colour === 'accent' ? String(theme.accentBackground.val) : colour;
  const [top, middle] = dark ? [0.5, 0.16] : [0.3, 0.1];
  return (
    <LinearGradient
      colors={[withAlpha(tint, top), withAlpha(tint, middle), clearOf(String(theme.background.val))]}
      locations={[0, 0.45, 1]}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, height, pointerEvents: 'none' }}
    />
  );
}
