import { TVEventControl } from 'react-native';

import { nativeTvMenu } from '../../modules/loge-tv-menu';
import { countedTvMenu } from './tv-menu-count';

/** Menu kept for the app on an Apple TV (`modules/loge-tv-menu`); nothing anywhere else. */
export const tvMenu = countedTvMenu({
  available: () => nativeTvMenu() !== undefined,
  enable: () => TVEventControl.enableTVMenuKey(),
  disable: () => TVEventControl.disableTVMenuKey(),
  native: (on) => {
    try {
      nativeTvMenu()?.hold(on);
    } catch {
      // Menu then pops the screen, as it did before: nothing worse.
    }
  },
});
