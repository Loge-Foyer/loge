import { AppState } from 'react-native';

import type { AppActivity } from '@/services/ports';

/** AppState, which react-native-web keeps from the page's visibility. */
export function createAppActivity(): AppActivity {
  return {
    active: () => AppState.currentState === 'active',
    subscribe: (listener) => {
      const subscription = AppState.addEventListener('change', (state) => listener(state === 'active'));
      return () => subscription.remove();
    },
  };
}
