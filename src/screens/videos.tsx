import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { Tv } from '@tamagui/lucide-icons-2/icons/Tv';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { XStack, YStack, useMedia } from 'tamagui';

import { EmptyState } from '@/components/empty-state';
import { CONTENT_KIND_LABELS, listKinds, listNames } from '@/components/labels';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { FileRowSkeleton, SectionTitle, ThumbnailSkeleton } from '@/components/shelf';
import { SourceTabs } from '@/components/source-tabs';
import { useServices } from '@/hooks/services-context';
import { useTabSources } from '@/hooks/use-sources';
import { categoryHref } from '@/screens/settings/plugin-route';
import { TAB_CONTENT } from '@/services/tab-content';

const PLACEHOLDERS = Array.from({ length: 8 }, (_, index) => index);

/**
 * Web video and plain files, one source at a time — a tab across the top for
 * each. What a source shows follows the kinds it brings, never its plugin.
 */
export function VideosScreen() {
  const { data: sources } = useTabSources('videos');
  const params = useLocalSearchParams<{ source?: string }>();

  if (!sources) return <Screen>{null}</Screen>;
  if (sources.length === 0) return <VideosEmptyState />;

  const selected = sources.find((source) => source.connection.id === params.source) ?? sources[0];
  if (!selected) return null;

  return (
    <Screen gap="$4">
      <SourceTabs
        tabs={sources.map((source) => ({ id: source.connection.id, label: source.connection.label }))}
        selected={selected.connection.id}
        onSelect={(id) => router.setParams({ source: id })}
      />
      {selected.kinds.map((kind) => (
        <YStack key={kind} gap="$3">
          {selected.kinds.length > 1 ? <SectionTitle>{CONTENT_KIND_LABELS[kind]}</SectionTitle> : null}
          {kind === 'files' ? <FileList /> : <VideoGrid />}
        </YStack>
      ))}
    </Screen>
  );
}

function VideoGrid() {
  const media = useMedia();
  const columns = media.lg ? 4 : media.md ? 3 : media.sm ? 2 : 1;
  const rows = Array.from({ length: Math.ceil(PLACEHOLDERS.length / columns) }, (_, row) =>
    PLACEHOLDERS.slice(row * columns, row * columns + columns),
  );
  return (
    <YStack gap="$4">
      {rows.map((cells, row) => (
        <XStack key={row} gap="$3">
          {Array.from({ length: columns }, (_, column) => (
            <YStack key={column} flex={1}>
              {cells[column] === undefined ? null : <ThumbnailSkeleton />}
            </YStack>
          ))}
        </XStack>
      ))}
    </YStack>
  );
}

function FileList() {
  return (
    <YStack rounded="$6" borderWidth={1} borderColor="$borderColor" bg="$color2" overflow="hidden">
      {PLACEHOLDERS.slice(0, 6).map((index) => (
        <YStack key={index} borderTopWidth={index === 0 ? 0 : 1} borderColor="$borderColor">
          <FileRowSkeleton />
        </YStack>
      ))}
    </YStack>
  );
}

function VideosEmptyState() {
  const { catalog } = useServices();
  const names = catalog.showingOn('videos').map((manifest) => manifest.displayName);
  return (
    <Screen>
      <EmptyState
        icon={<Tv size={26} color="$accent11" />}
        title="Nothing to watch here yet"
        body={`Connect a source that brings ${listKinds(TAB_CONTENT.videos)}${names.length > 0 ? ` — ${listNames(names)}` : ''}. Each one gets its own tab here.`}
      >
        <Link href={categoryHref('sources')} asChild>
          <PrimaryButton size="$4" icon={Plus}>
            Add a source
          </PrimaryButton>
        </Link>
      </EmptyState>
    </Screen>
  );
}
