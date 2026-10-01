import { Button as TamaguiButton } from 'tamagui';

import { remotely } from './remote';

/**
 * Tamagui's Button, which a TV remote can also press (`remote.tsx`). Every
 * button the app draws comes from here — lint says so — because one taken
 * from Tamagui directly takes the focus on a TV and ignores the select.
 */
export const Button = remotely(TamaguiButton);

/** Tamagui's own, for `styled()` to build on. Wrap what it makes in `remotely`. */
export { TamaguiButton };
