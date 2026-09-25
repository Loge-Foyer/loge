import { Film } from '@tamagui/lucide-icons-2/icons/Film';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { Link } from 'expo-router';
import { Paragraph, SizableText, YStack } from 'tamagui';

import { Chip, ChipRow } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { CONTENT_KIND_LABELS, listKinds, listNames } from '@/components/labels';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { PosterSkeleton, Shelf, usePosterWidth } from '@/components/shelf';
import { useServices } from '@/hooks/services-context';
import { useTabSources } from '@/hooks/use-sources';
import { TAB_CONTENT } from '@/services/tab-content';
import type { TabSource } from '@/services/sources';

const PLACEHOLDERS = Array.from({ length: 10 }, (_, index) => index);

/**
 * The library, across every source that brings films, series or anime.
 * Titles need the media contract, which does not exist yet, so the shelves
 * show their shape for each kind the connected sources bring.
 */
export function MediaScreen() {
  const { data: sources } = useTabSources('media');
  const posterWidth = usePosterWidth();

  if (!sources) return <Screen>{null}</Screen>;
  if (sources.length === 0) return <MediaEmptyState />;

  const kinds = TAB_CONTENT.media.filter((kind) => sources.some((source) => source.kinds.includes(kind)));
  return (
    <Screen>
      <Hero sources={sources} />
      {kinds.map((kind) => (
        <Shelf key={kind} title={CONTENT_KIND_LABELS[kind]}>
          {PLACEHOLDERS.map((index) => (
            <PosterSkeleton key={index} width={posterWidth} />
          ))}
        </Shelf>
      ))}
    </Screen>
  );
}

function Hero({ sources }: { sources: readonly TabSource[] }) {
  return (
    <YStack
      rounded="$9"
      overflow="hidden"
      bg="$color3"
      borderWidth={1}
      borderColor="$color4"
      aspectRatio={4 / 5}
      $sm={{ aspectRatio: 16 / 9 }}
      $lg={{ aspectRatio: 21 / 9 }}
      justify="flex-end"
      p="$5"
      gap="$3"
    >
      <YStack gap="$2" maxW={520}>
        <YStack height={28} width="70%" rounded="$3" bg="$color5" />
        <YStack height={12} width="90%" rounded="$2" bg="$color4" />
        <YStack height={12} width="60%" rounded="$2" bg="$color4" />
      </YStack>
      <ChipRow>
        {sources.map((source) => (
          <Chip key={source.connection.id} label={source.connection.label} tone="accent" />
        ))}
      </ChipRow>
      <Paragraph size="$2" color="$color10">
        Connected. Titles appear here once sources can list them.
      </Paragraph>
    </YStack>
  );
}

function MediaEmptyState() {
  const { catalog } = useServices();
  const names = catalog.bringing(TAB_CONTENT.media).map((manifest) => manifest.displayName);
  return (
    <Screen>
      <EmptyState
        icon={<Film size={26} color="$accent11" />}
        title="Your library starts here"
        body={`Connect a source that brings ${listKinds(TAB_CONTENT.media)}${names.length > 0 ? ` — ${listNames(names)}` : ''}. Films and series from all of them share one library.`}
      >
        <Link href={{ pathname: '/settings/plugins', params: { for: 'media' } }} asChild>
          <PrimaryButton size="$4" icon={Plus}>
            Add a source
          </PrimaryButton>
        </Link>
      </EmptyState>
      <SizableText size="$2" color="$color9">
        Sources are installed once per device and shared by every profile, unless a plugin is set
        to be configured per profile.
      </SizableText>
    </Screen>
  );
}
