import type { UserId } from '@sc/api';
import { createContext, use, useSyncExternalStore } from 'react';

import type { Gate } from '@/services/boot';

import { useServices } from './services-context';

export function useGate(): Gate {
  const { session } = useServices();
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}

/**
 * Provided by the tab navigator, which only renders behind the `ready` gate and
 * is keyed by the profile — so nothing below it can outlive a profile switch.
 */
export const ActiveUserContext = createContext<UserId | null>(null);

export function useActiveUserId(): UserId {
  const userId = use(ActiveUserContext);
  if (!userId) throw new Error('useActiveUserId() is only available inside the tabs.');
  return userId;
}
