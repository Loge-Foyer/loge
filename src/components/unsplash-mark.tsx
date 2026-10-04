import { Path, Svg } from 'react-native-svg';

/**
 * Unsplash's mark, for crediting a photograph taken from it: Who's watching on
 * a TV (`assets/backgrounds`). The path is Simple Icons' (CC0); the mark is
 * Unsplash's. Like `EyeFilled`, it takes a resolved colour, not a theme token.
 */
export function UnsplashMark({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7.5 6.75V0h9v6.75h-9zm9 3.75H24V24H0V10.5h7.5v6.75h9V10.5z" fill={color} />
    </Svg>
  );
}
