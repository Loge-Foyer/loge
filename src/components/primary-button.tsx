import { Button, styled } from 'tamagui';

/** The one call to action on a surface, in the app's accent. */
export const PrimaryButton = styled(Button, {
  bg: '$accentBackground',
  color: '$accentColor',
  borderWidth: 0,
  fontWeight: '600',
  hoverStyle: { bg: '$accent10' },
  pressStyle: { bg: '$accent8' },
});
