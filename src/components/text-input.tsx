import { Input, styled } from 'tamagui';

/** The app's text input. Placeholders sit well below values, so an empty field reads as empty. */
export const TextInput = styled(Input, {
  placeholderTextColor: '$color8',
});
