import { useQuery } from '@tanstack/react-query';

import { userKey } from '@/services/query-keys';
import type { ContentTab } from '@/services/tab-content';

import { useServices } from './services-context';
import { useActiveUserId } from './use-session';

export function useSources() {
  const userId = useActiveUserId();
  const { sources } = useServices();
  return useQuery({ queryKey: userKey(userId, 'sources'), queryFn: () => sources.forUser(userId) });
}

export function useTabSources(tab: ContentTab) {
  const userId = useActiveUserId();
  const { sources } = useServices();
  return useQuery({
    queryKey: userKey(userId, 'sources', tab),
    queryFn: () => sources.forTab(userId, tab),
  });
}
