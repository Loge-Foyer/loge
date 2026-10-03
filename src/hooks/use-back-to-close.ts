import { useEffect, useEffectEvent } from 'react';
import { BackHandler, Platform, TVEventControl } from 'react-native';

import { isTV } from '@/components/remote';

/**
 * While `open`, Back closes what is open rather than the screen beneath it:
 * Android's back, and an Apple TV remote's Menu — which tvOS hands to the app
 * only while asked to, so on a TV it is best effort. The web has neither
 * (`use-back-to-close.web.ts`).
 */
export function useBackToClose(open: boolean, close: () => void) {
  const onBack = useEffectEvent(close);
  useEffect(() => {
    if (!open) return;
    const menu = isTV && Platform.OS === 'ios';
    if (menu) TVEventControl.enableTVMenuKey();
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => {
      subscription.remove();
      if (menu) TVEventControl.disableTVMenuKey();
    };
  }, [open]);
}
