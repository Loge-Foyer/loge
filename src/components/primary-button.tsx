import { styled } from 'tamagui';

import { TamaguiButton } from './button';
import { remotely } from './remote';

/** The one call to action on a surface, in the app's accent — pressable with a remote too. */
export const PrimaryButton = remotely(
  styled(TamaguiButton, {
    bg: '$accentBackground',
    color: '$accentColor',
    borderWidth: 0,
    fontWeight: '600',
    hoverStyle: { bg: '$accent10' },
    pressStyle: { bg: '$accent8' },
  }),
);
