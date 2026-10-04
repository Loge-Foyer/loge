import { Cast } from '@tamagui/lucide-icons-2/icons/Cast';

import { Button } from './button';
import { HeaderButton } from './header-button';

// Nothing casts yet: the button has its place in the layouts, and shows once
// a cast target can be found and played to.
const CASTING = false as boolean;

/**
 * Plays what is in front on a screen across the room — once casting exists.
 * In a bar it is a symbol among the bar's own; over a picture, a round button
 * of its own (`HeaderButton`).
 */
export function CastButton({ variant = 'bar', inHeader = false }: { variant?: 'bar' | 'floating'; inHeader?: boolean }) {
  if (!CASTING) return null;
  if (variant === 'floating') return <HeaderButton icon={Cast} label="Cast" inHeader={inHeader} onPress={() => undefined} />;
  return <Button size="$3" circular chromeless aria-label="Cast" icon={<Cast size={20} color="$color11" />} onPress={() => undefined} />;
}
