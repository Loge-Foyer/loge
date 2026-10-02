import type { NetworkKind } from '@loge/api';
import * as Network from 'expo-network';

import type { NetworkMonitor } from '@/services/ports';

/**
 * The kind of network the device is on, as far as the platform can tell. A
 * browser only knows online or offline, so the web never reports mobile data.
 */
export function createNetworkMonitor(): NetworkMonitor {
  let current: NetworkKind = 'unknown';
  const listeners = new Set<(kind: NetworkKind, previous: NetworkKind) => void>();

  const update = (state: Network.NetworkState) => {
    const next = kindOf(state);
    if (next === current) return;
    const previous = current;
    current = next;
    for (const listener of listeners) listener(next, previous);
  };

  void Network.getNetworkStateAsync().then(update, () => undefined);
  // Kept for the life of the runtime, like the service graph that owns it.
  Network.addNetworkStateListener(update);

  return {
    current: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function kindOf(state: Network.NetworkState): NetworkKind {
  if (state.isConnected === false) return 'none';
  switch (state.type) {
    case Network.NetworkStateType.WIFI:
      return 'wifi';
    case Network.NetworkStateType.CELLULAR:
      return 'cellular';
    case Network.NetworkStateType.ETHERNET:
      return 'ethernet';
    case Network.NetworkStateType.NONE:
      return 'none';
    case Network.NetworkStateType.UNKNOWN:
    case undefined:
      return 'unknown';
    default:
      return 'other';
  }
}
