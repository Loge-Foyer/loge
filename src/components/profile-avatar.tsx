import type { AppUser } from '@loge/api';
import { Circle, SizableText, Square, Theme } from 'tamagui';

// Colour follows the profile id, so a profile keeps its colour across renames.
const HUES = ['blue', 'green', 'orange', 'pink', 'purple', 'red', 'yellow', 'teal'] as const;

function hueFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[hash % HUES.length] ?? 'blue';
}

// Its colours are the dark theme's in either: on a light page the lightest
// step written on step 9 vanished from a yellow one. Square in who's
// watching and on the profile's own button; round everywhere else.
export function ProfileAvatar({
  user,
  size = 40,
  shape = 'circle',
}: {
  user: Pick<AppUser, 'id' | 'name'>;
  size?: number;
  shape?: 'circle' | 'square';
}) {
  const hue = hueFor(user.id);
  const initial = (
    <SizableText fontSize={size * 0.42} lineHeight={size} fontWeight="700" color="$color1">
      {user.name.slice(0, 1).toUpperCase()}
    </SizableText>
  );
  return (
    <Theme name="dark">
      {shape === 'square' ? (
        <Square size={size} rounded="$4" theme={hue} bg="$color9">
          {initial}
        </Square>
      ) : (
        <Circle size={size} theme={hue} bg="$color9">
          {initial}
        </Circle>
      )}
    </Theme>
  );
}
