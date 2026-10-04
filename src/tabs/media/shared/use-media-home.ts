import type { ContentKind, MediaItem } from '@loge/api';
import { useCallback, useState } from 'react';

import { rowTitle } from '@/components/labels';
import { useDownloads } from '@/hooks/use-downloads';
import { useHomeRows } from '@/hooks/use-home-layout';
import { ROW_LIMIT, useContinueWatching, useHomeRowQueries, useRefreshMedia } from '@/hooks/use-media';
import { usePendingSources } from '@/hooks/use-sources';
import { itemMatches, narrowRows, type HomeFilter } from '@/services/home-filter';
import { specOf, type HomeRowView, type TitlesRow } from '@/services/home-layout';
import type { SourceError } from '@/services/media';
import { TAB_CONTENT } from '@/services/tab-content';

/** One row as a home draws it. */
export interface MediaHomeRow {
  readonly row: HomeRowView;
  readonly title: string;
  readonly items: readonly MediaItem[];
  readonly loading: boolean;
  /** Its sources hold more than the row shows: its grid has the rest. */
  readonly more: boolean;
}

const isTitles = (row: HomeRowView): row is TitlesRow & HomeRowView => row.type === 'titles';

/**
 * What the home shows under a filter, for a phone's home and a TV's alike:
 * Continue Watching, what this device keeps of the library, and the profile's
 * own rows, narrowed — with what each could not reach gathered into one list
 * of notices, and the kinds the sources bring for the chips over it.
 */
export function useMediaHome(filter: HomeFilter) {
  const { rows, sources, feeds } = useHomeRows();
  const { data: pending = [] } = usePendingSources();
  const refreshMedia = useRefreshMedia();
  const [refreshing, setRefreshing] = useState(false);

  const shown = rows && feeds ? narrowRows(rows, filter, feeds) : [];
  const titled = shown.filter(isTitles);
  const showContinue = shown.some((row) => row.type === 'continue');
  const results = useHomeRowQueries(titled.map(specOf));
  const continuing = useContinueWatching(showContinue);
  const { data: kept = [] } = useDownloads();

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshMedia();
    } finally {
      setRefreshing(false);
    }
  }, [refreshMedia]);

  const list = sources ?? [];
  // Whoever keeps it — the source, or the app for one that keeps none.
  const watching = new Set(list.filter((source) => source.watch !== undefined).map((source) => source.connection.id));
  const playing = new Set(list.filter((source) => source.effective.media?.capabilities.has('playback')).map((source) => source.connection.id));
  // The library's own kept copies — a web video kept from Videos is Videos' — finished, newest first.
  const onMedia = new Set(list.map((source) => source.connection.id));
  const downloaded = kept
    .filter((entry) => entry.state === 'done' && onMedia.has(entry.key.connectionId))
    .map((entry) => entry.item)
    .filter((item) => itemMatches(item, filter));

  const homeRows: MediaHomeRow[] = shown.flatMap((row): MediaHomeRow[] => {
    if (row.type === 'continue') {
      const items = (continuing.data?.items ?? []).filter((item) => itemMatches(item, filter));
      if (!continuing.isPending && items.length === 0) return [];
      return [{ row, title: rowTitle(row), items, loading: continuing.isPending, more: false }];
    }
    if (row.type === 'downloads') return downloaded.length === 0 ? [] : [{ row, title: rowTitle(row), items: downloaded, loading: false, more: false }];
    const result = results[titled.indexOf(row)];
    const items = result?.data?.items ?? [];
    const loading = result?.isPending ?? true;
    // A row nothing fills is left out — but the filter's own row says why the home is empty.
    if (!loading && items.length === 0 && row.available) return [];
    return [{ row, title: rowTitle(row), items, loading, more: items.length >= ROW_LIMIT }];
  });

  const errors: SourceError[] = [
    ...(showContinue ? (continuing.data?.sourceErrors ?? []) : []),
    ...results.flatMap((result) => result.data?.sourceErrors ?? []),
  ];
  const kinds: readonly ContentKind[] = TAB_CONTENT.media.filter((kind) => feeds?.kinds.has(kind) ?? false);

  return {
    ready: rows !== undefined && sources !== undefined,
    sources: list,
    pending,
    rows: homeRows,
    errors,
    kinds,
    feeds,
    refresh,
    refreshing,
    /** Watch badges only where someone keeps what was watched. */
    watchFrom: (item: MediaItem) => watching.has(item.key.connectionId),
    /** The source can play what it brings. */
    playsFrom: (item: MediaItem) => playing.has(item.key.connectionId),
    /** Continue Watching's picture plays: a film or an episode, from a source that can play it. */
    resumesFrom: (item: MediaItem) => playing.has(item.key.connectionId) && (item.type === 'movie' || item.type === 'episode'),
    cannotList: list.filter((source) => !source.effective.media?.capabilities.has('browse')),
  };
}
