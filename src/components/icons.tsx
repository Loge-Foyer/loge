import { Circle, Path, Svg } from 'react-native-svg';

/**
 * Lucide's eye, filled: what the eye on a title's page shows once it is
 * watched, beside the outline for not yet. Lucide draws outlines only.
 *
 * Made for a button's `icon`, which hands it a resolved size and colour — not
 * a theme token, which only Lucide's own wrapper resolves.
 */
export function EyeFilled({ size = 24, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* The eye, with the iris cut out of it: the background shows round the pupil. */}
      <Path
        d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z"
        fill={color}
        fillRule="evenodd"
      />
      {/* The outline's own edge, so the filled eye is as large as the outlined one. */}
      <Path
        d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={2.25} fill={color} />
    </Svg>
  );
}
