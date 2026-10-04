import { Slot, Stack } from 'expo-router';

import { titleHasOwnStack, titleStackOptions } from '@/components/stack-options';

/** A title's sheet: with a stack of its own where the platform can draw its header (`titleHasOwnStack`). */
export default function TitleLayout() {
  return titleHasOwnStack ? <Stack screenOptions={titleStackOptions} /> : <Slot />;
}
