import { Slot, Stack } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { titleHasOwnStack, titleStackOptions } from '@/components/stack-options';

/**
 * A title's sheet: with a stack of its own where the platform can draw its
 * header (`titleHasOwnStack`). An iOS form sheet gives a height only to a
 * scroll view sitting straight in it, so the stack is given the sheet's own:
 * the window's, less the top of the safe area, where the large detent starts.
 */
export default function TitleLayout() {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (!titleHasOwnStack) return <Slot />;
  return (
    <View style={{ height: height - insets.top }}>
      <Stack screenOptions={titleStackOptions} />
    </View>
  );
}
