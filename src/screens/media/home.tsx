import type { MediaItem, PerProfile } from '@sc/api';
import { Film } from '@tamagui/lucide-icons-2/icons/Film';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { RefreshCw } from '@tamagui/lucide-icons-2/icons/RefreshCw';
import { Link } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl } from 'react-native';
import { Button, Paragraph, SizableText, XStack, YStack, useTheme } from 'tamagui';

import { CustomizeButton } from '@/components/customize-button';
import { EmptyState } from '@/components/empty-state';
import { listKinds, listNames, rowTitle } from '@/components/labels';
import { MediaRow } from '@/components/media/media-row';
import { SourceNotices } from '@/components/media/source-notices';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { useLandscapeWidth, usePosterWidth } from '@/components/shelf';
import { useServices } from '@/hooks/services-context';
import { useHomeRows } from '@/hooks/use-home-layout';
import { useContinueWatching, useHomeRowQueries, useRefreshMedia } from '@/hooks/use-media';
import { useActiveUserId } from '@/hooks/use-session';
import { usePendingSources } from '@/hooks/use-sources';
import { categoryHref } from '@/screens/settings/plugin-route';
import type { HomeRowView } from '@/services/home-layout';
import type { SourceError } from '@/services/media';
import { TAB_CONTENT } from '@/services/tab-content';

const isWeb = process.env.EXPO_OS === 'web';

type KindRow = Extract<HomeRowView, { type: 'kind' }>;

/**
 * The library across every source that brings films, series or anime: what is
 * being watched first, then one row per kind in the profile's own order and
 * sort. A source that cannot answer gets one quiet line at the top, however
 * many rows it would have filled.
 */
export function MediaHomeScreen() {
  const { rows, sources } = useHomeRows();
  const { data: pending = [] } = usePendingSources();
  const refresh = useRefreshMedia();
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const posterWidth = usePosterWidth();
  const landscapeWidth = useLandscapeWidth();

  const visible = (rows ?? []).filter((row) => !row.hidden && row.available);
  const kindRows = visible.filter((row): row is KindRow => row.type === 'kind');
  const showContinue = visible.some((row) => row.type === 'continue');
  const results = useHomeRowQueries(kindRows.map((row) => ({ kind: row.kind, sort: row.sort })));
  const continuing = useContinueWatching(showContinue);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  if (!rows || !sources) return <Screen>{null}</Screen>;
  if (sources.length === 0) return pending.length > 0 ? <SetUpScreen pending={pending} /> : <MediaEmptyState />;

  const watching = new Set(
    sources.filter((source) => source.effective.media?.capabilities.has('watchStateRead')).map((source) => source.connection.id),
  );
  const watchFrom = (item: MediaItem) => watching.has(item.key.connectionId);
  const cannotList = sources.filter((source) => !source.effective.media?.capabilities.has('browse'));
  const errors: SourceError[] = [
    ...(showContinue ? (continuing.data?.sourceErrors ?? []) : []),
    ...results.flatMap((result) => result.data?.sourceErrors ?? []),
  ];

  return (
    <Screen
      flush
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={String(theme.color10.val)} />
      }
    >
      {isWeb ? (
        // The top bar is the header in a browser, and a browser cannot pull to refresh.
        <XStack px="$4" gap="$2" justify="flex-end" items="center">
          <Button size="$3" chromeless icon={RefreshCw} disabled={refreshing} onPress={() => void onRefresh()}>
            Refresh
          </Button>
          <CustomizeButton />
        </XStack>
      ) : null}

      {pending.length > 0 || errors.length > 0 ? (
        <YStack px="$4" gap="$3">
          {pending.map(({ connection }) => (
            <SetUpCallout key={connection.id} connection={connection} />
          ))}
          <SourceNotices errors={errors} onRetry={() => void onRefresh()} />
        </YStack>
      ) : null}

      {visible.map((row) => {
        if (row.type === 'continue') {
          const data = continuing.data;
          if (!continuing.isPending && (data?.items.length ?? 0) === 0) return null;
          return (
            <MediaRow
              key={row.id}
              title={rowTitle(row)}
              items={data?.items ?? []}
              loading={continuing.isPending}
              sourceErrors={[]}
              card="landscape"
              width={landscapeWidth}
              watchFrom={watchFrom}
            />
          );
        }
        const result = results[kindRows.indexOf(row)];
        const items = result?.data?.items ?? [];
        if (result && !result.isPending && items.length === 0) return null;
        return (
          <MediaRow
            key={row.id}
            title={rowTitle(row)}
            href={{ pathname: '/browse/[rowId]', params: { rowId: row.id } }}
            items={items}
            loading={result?.isPending ?? true}
            sourceErrors={[]}
            card={row.card}
            width={row.card === 'poster' ? posterWidth : landscapeWidth}
            watchFrom={watchFrom}
          />
        );
      })}

      {cannotList.length > 0 ? (
        <Paragraph px="$4" size="$2" color="$color9">
          {`${listNames(cannotList.map((source) => source.connection.label))} ${cannotList.length === 1 ? 'is' : 'are'} connected but cannot list titles yet.`}
        </Paragraph>
      ) : null}
    </Screen>
  );
}

interface PendingConnection {
  readonly id: string;
  readonly label: string;
  readonly perProfile: PerProfile;
}

function SetUpCallout({ connection }: { connection: PendingConnection }) {
  const userId = useActiveUserId();
  return (
    <XStack gap="$3" items="center" p="$3" rounded="$6" bg="$accent2" borderWidth={1} borderColor="$accent5">
      <SizableText size="$3" color="$color12" flex={1}>
        {connection.perProfile === 'credentials'
          ? `${connection.label} needs your own sign-in.`
          : `${connection.label} needs your own details.`}
      </SizableText>
      <Link
        href={{ pathname: '/settings/connections/[connectionId]', params: { connectionId: connection.id, profile: userId } }}
        asChild
      >
        <PrimaryButton size="$3">Finish setting up</PrimaryButton>
      </Link>
    </XStack>
  );
}

function SetUpScreen({ pending }: { pending: readonly { connection: PendingConnection }[] }) {
  return (
    <Screen>
      <EmptyState
        icon={<Film size={26} color="$accent11" />}
        title="Almost there"
        body={
          pending.length === 1
            ? 'This source keeps separate details for each profile. Add yours to see its library.'
            : 'These sources keep separate details for each profile. Add yours to see their libraries.'
        }
      >
        <YStack gap="$3" width="100%">
          {pending.map(({ connection }) => (
            <SetUpCallout key={connection.id} connection={connection} />
          ))}
        </YStack>
      </EmptyState>
    </Screen>
  );
}

function MediaEmptyState() {
  const { catalog } = useServices();
  const names = catalog.showingOn('media').map((manifest) => manifest.displayName);
  return (
    <Screen>
      <EmptyState
        icon={<Film size={26} color="$accent11" />}
        title="Your library starts here"
        body={`Connect a source that brings ${listKinds(TAB_CONTENT.media)}${names.length > 0 ? ` — ${listNames(names)}` : ''}. Films and series from all of them share one library.`}
      >
        <Link href={categoryHref('sources')} asChild>
          <PrimaryButton size="$4" icon={Plus}>
            Add a source
          </PrimaryButton>
        </Link>
      </EmptyState>
      <SizableText size="$2" color="$color9">
        Sources belong to your account, and every profile sees them — unless a connection keeps a separate sign-in
        for each profile.
      </SizableText>
    </Screen>
  );
}
