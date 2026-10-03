import type { AppUser } from '@loge/api';
import { Circle, SizableText, Theme } from 'tamagui';

// Colour follows the profile id, so a profile keeps its colour across renames.
const HUES = ['blue', 'green', 'orange', 'pink', 'purple', 'red', 'yellow', 'teal'] as const;

function hueFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[hash % HUES.length] ?? 'blue';
}

// Its colours are the dark theme's in either: on a light page the lightest
// step written on step 9 vanished from a yellow one.
export function ProfileAvatar({ user, size = 40 }: { user: Pick<AppUser, 'id' | 'name'>; size?: number }) {
  return (
    <Theme name="dark">
      <Circle size={size} theme={hueFor(user.id)} bg="$color9">
        <SizableText fontSize={size * 0.42} lineHeight={size} fontWeight="700" color="$color1">
          {user.name.slice(0, 1).toUpperCase()}
        </SizableText>
      </Circle>
    </Theme>
  );
}
