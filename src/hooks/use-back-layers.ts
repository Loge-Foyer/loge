import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { AppState, BackHandler } from 'react-native';

import { useServices } from './services-context';

/** The native stack's own event, which the generic navigation type does not list. */
type TransitionEvents = { addListener(type: 'transitionEnd', listener: (event: { readonly data: { readonly closing: boolean } }) => void): () => void };

/**
 * Back closes the layer on top — a panel, a field — before the screen goes:
 * `closeTop` while something is open, nothing while nothing is. Android's Back
 * reaches here as it is; an Apple TV's Menu only while it is held for the app
 * (`tvMenu`), since UIKit pops a pushed screen before the app hears it — so it
 * is held only while a layer is open, and Menu leaves the screen as ever once
 * none is. Held again after each transition and on coming back to the app,
 * which re-arm UIKit's own. The player keeps its own, which knows its layers.
 */
export function useBackLayers(closeTop: (() => void) | undefined) {
  const { tvMenu } = useServices();
  const navigation = useNavigation() as unknown as TransitionEvents;
  const latest = useRef(closeTop);
  useLayoutEffect(() => {
    latest.current = closeTop;
  });
  const open = closeTop !== undefined;
  useFocusEffect(
    useCallback(() => {
      if (!open) return undefined;
      const release = tvMenu.hold();
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        latest.current?.();
        return true;
      });
      const stopTransition = navigation.addListener('transitionEnd', (event) => {
        if (!event.data.closing) tvMenu.refresh();
      });
      const active = AppState.addEventListener('change', (state) => {
        if (state === 'active') tvMenu.refresh();
      });
      return () => {
        back.remove();
        stopTransition();
        active.remove();
        release();
      };
    }, [open, tvMenu, navigation]),
  );
}
