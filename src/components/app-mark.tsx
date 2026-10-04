import { Image } from 'expo-image';

import { px } from './density';

// The app's icon at 128 pixels: enough for a header's size at three times.
const ICON = require('@/assets/images/icon-header.png');

/**
 * Loge's own icon, small, with its corners rounded as a home screen draws
 * them: where a page names the app rather than itself — the top left of
 * Media's home. It is the icon as it ships, not artwork, so it is drawn
 * straight from the bundle.
 */
export function AppMark({ size = px(30) }: { size?: number }) {
  return (
    <Image
      source={ICON}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.225) }}
      contentFit="cover"
      accessibilityLabel="Loge"
      accessibilityRole="image"
    />
  );
}
