import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { normalizeLayout, type HomeRow } from '@/services/home-layout';
import { userKey } from '@/services/query-keys';

import { useServices } from './services-context';
import { useDownloadBudget } from './use-downloads';
import { useActiveUserId } from './use-session';
import { useTabSources } from './use-sources';

/** The home's rows for this profile, against what its sources can bring right now. */
export function useHomeRows() {
  const userId = useActiveUserId();
  const { homeLayout } = useServices();
  const layout = useQuery({ queryKey: userKey(userId, 'home-layout'), queryFn: () => homeLayout.rows(userId) });
  const { data: sources } = useTabSources('media');
  // A TV and a browser have nowhere to keep a film.
  const { data: budget } = useDownloadBudget();
  const canKeep = (budget?.limitBytes ?? 0) > 0;
  const rows = useMemo(() => {
    if (!layout.data || !sources) return undefined;
    const kinds = new Set(
      sources.filter((source) => source.effective.media?.capabilities.has('browse')).flatMap((source) => source.kinds),
    );
    // A source's resume list, or what the app keeps for one that keeps none.
    const canContinue = sources.some((source) => source.watch !== undefined);
    return normalizeLayout({ version: 2, rows: layout.data }, kinds, canContinue, canKeep);
  }, [layout.data, sources, canKeep]);
  return { rows, sources };
}

/** Changes apply at once and are stored behind them; a failed write puts the old rows back. */
export function useHomeLayoutActions() {
  const userId = useActiveUserId();
  const { homeLayout } = useServices();
  const client = useQueryClient();
  const key = userKey(userId, 'home-layout');

  const update = useMutation({
    mutationFn: (change: (rows: readonly HomeRow[]) => readonly HomeRow[]) => homeLayout.update(userId, change),
    onMutate: async (change) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<readonly HomeRow[]>(key);
      if (previous) client.setQueryData(key, change(previous));
      return { previous };
    },
    onError: (_error, _change, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });

  const reset = useMutation({
    mutationFn: () => homeLayout.reset(userId),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });

  return { update, reset };
}
