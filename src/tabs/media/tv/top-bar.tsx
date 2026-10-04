import type { ContentKind } from '@loge/api';
import { ChevronDown } from '@tamagui/lucide-icons-2/icons/ChevronDown';
import { RefreshCw } from '@tamagui/lucide-icons-2/icons/RefreshCw';
import { Search } from '@tamagui/lucide-icons-2/icons/Search';
import { SlidersHorizontal } from '@tamagui/lucide-icons-2/icons/SlidersHorizontal';
import { X } from '@tamagui/lucide-icons-2/icons/X';
import { router } from 'expo-router';
import { useState } from 'react';
import { XStack } from 'tamagui';

import { Button } from '@/components/button';
import { GUTTER, px } from '@/components/density';
import { FocusGroup } from '@/components/focus-group';
import { CONTENT_KIND_LABELS } from '@/components/labels';
import { OverlayPicker } from '@/components/overlay-picker';
import { ProfileButton } from '@/components/profile-button';
import { CHOSEN } from '@/components/settings-list';
import { useGenres } from '@/hooks/use-media';
import { isFiltered, type HomeFilter } from '@/services/home-filter';

import { chipsFor } from '../shared/filter-chips';
import { SEARCH_HREF } from '../shared/links';

// "All categories" in the picker: no genre, which no source names.
const EVERY_GENRE = '';

/**
 * What heads a TV's home: the profile, the chips that narrow the home, then
 * Customize, Refresh and — at the top right, while nothing narrows the home —
 * Search, as a phone has it. One focus group, so up from the rows lands where
 * the remote last was in it.
 */
export function TopBar({
  filter,
  kinds,
  refreshing,
  onFilter,
  onRefresh,
}: {
  filter: HomeFilter;
  kinds: readonly ContentKind[];
  refreshing: boolean;
  onFilter: (filter: HomeFilter) => void;
  onRefresh: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const genres = useGenres(filter.kind === undefined ? kinds : [filter.kind], choosing || filter.genre !== undefined);
  const chips = kinds.length > 0 ? chipsFor(filter, kinds) : [];
  return (
    <FocusGroup>
      <XStack px={GUTTER} gap="$3" items="center" flexWrap="wrap">
        <ProfileButton />
        {chips.map((chip) => {
          if (chip.type === 'clear') return <Button key="clear" size="$4" circular icon={<X size={px(20)} />} aria-label="Show everything" onPress={() => onFilter({})} />;
          if (chip.type === 'kind') {
            return (
              <Chip
                key={chip.kind}
                label={CONTENT_KIND_LABELS[chip.kind]}
                chosen={chip.chosen}
                onPress={() => {
                  const { kind: _kind, ...rest } = filter;
                  onFilter(chip.chosen ? rest : { ...filter, kind: chip.kind });
                }}
              />
            );
          }
          return <Chip key="categories" label={chip.genre ?? 'Categories'} chosen={chip.genre !== undefined} opens onPress={() => setChoosing(true)} />;
        })}
        <XStack flex={1} />
        <Button size="$4" icon={<SlidersHorizontal size={px(18)} />} onPress={() => router.push('/customize-home')}>
          Customize
        </Button>
        <Button size="$4" icon={<RefreshCw size={px(18)} />} disabled={refreshing} onPress={onRefresh}>
          Refresh
        </Button>
        {/* Search is the whole home's: none while a chip narrows it. */}
        {isFiltered(filter) ? null : <Button size="$4" circular icon={<Search size={px(22)} />} aria-label="Search" onPress={() => router.push(SEARCH_HREF)} />}
      </XStack>
      <OverlayPicker
        open={choosing}
        label="Categories"
        options={[{ id: EVERY_GENRE, label: 'All categories' }, ...(genres.data?.genres ?? []).map((genre) => ({ id: genre, label: genre }))]}
        selected={filter.genre ?? EVERY_GENRE}
        onSelect={(genre) => {
          const { genre: _genre, ...rest } = filter;
          onFilter(genre === EVERY_GENRE ? rest : { ...rest, genre });
        }}
        onClose={() => setChoosing(false)}
      />
    </FocusGroup>
  );
}

function Chip({ label, chosen, opens = false, onPress }: { label: string; chosen: boolean; opens?: boolean; onPress: () => void }) {
  return (
    <Button
      size="$4"
      rounded="$10"
      borderWidth={0}
      bg={chosen ? CHOSEN.bg : '$color3'}
      color={chosen ? CHOSEN.color : '$color12'}
      {...(opens ? { iconAfter: <ChevronDown size={px(16)} color={chosen ? CHOSEN.color : '$color12'} /> } : {})}
      onPress={onPress}
    >
      {label}
    </Button>
  );
}
