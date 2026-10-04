import type { ContentKind } from '@loge/api';
import { ChevronDown } from '@tamagui/lucide-icons-2/icons/ChevronDown';
import { RefreshCw } from '@tamagui/lucide-icons-2/icons/RefreshCw';
import { Search } from '@tamagui/lucide-icons-2/icons/Search';
import { SlidersHorizontal } from '@tamagui/lucide-icons-2/icons/SlidersHorizontal';
import { X } from '@tamagui/lucide-icons-2/icons/X';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import type { View } from 'react-native';
import { XStack } from 'tamagui';

import { Button } from '@/components/button';
import { GUTTER, px } from '@/components/density';
import { FocusGroup } from '@/components/focus-group';
import { CONTENT_KIND_LABELS } from '@/components/labels';
import { OverlayPicker } from '@/components/overlay-picker';
import { ProfileButton } from '@/components/profile-button';
import { CHOSEN } from '@/components/settings-list';
import { useTvBack } from '@/components/tv-back';
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
 * the remote last was in it. Back's first press sends the remote to its first
 * control, the profile.
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
  const back = useTvBack();
  const profile = useRef<View>(null);
  const toFirst = () => profile.current?.requestTVFocus();
  return (
    <FocusGroup>
      <XStack px={GUTTER} gap="$3" items="center" flexWrap="wrap">
        <ProfileButton
          ref={profile}
          onFocus={() => back?.at('top:profile', { first: true, toFirst })}
          onBlur={() => back?.left('top:profile')}
        />
        {chips.map((chip) => {
          if (chip.type === 'clear') {
            return (
              <Button
                key="clear"
                size="$4"
                circular
                icon={<X size={px(20)} />}
                aria-label="Show everything"
                onPress={() => onFilter({})}
                onFocus={() => back?.at('top:clear', { first: false, toFirst })}
                onBlur={() => back?.left('top:clear')}
              />
            );
          }
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
                onFocus={() => back?.at(`top:${chip.kind}`, { first: false, toFirst })}
                onBlur={() => back?.left(`top:${chip.kind}`)}
              />
            );
          }
          return (
            <Chip
              key="categories"
              label={chip.genre ?? 'Categories'}
              chosen={chip.genre !== undefined}
              opens
              onPress={() => setChoosing(true)}
              onFocus={() => back?.at('top:categories', { first: false, toFirst })}
              onBlur={() => back?.left('top:categories')}
            />
          );
        })}
        <XStack flex={1} />
        <Button
          size="$4"
          icon={<SlidersHorizontal size={px(18)} />}
          onPress={() => router.push('/customize-home')}
          onFocus={() => back?.at('top:customize', { first: false, toFirst })}
          onBlur={() => back?.left('top:customize')}
        >
          Customize
        </Button>
        <Button
          size="$4"
          icon={<RefreshCw size={px(18)} />}
          disabled={refreshing}
          onPress={onRefresh}
          onFocus={() => back?.at('top:refresh', { first: false, toFirst })}
          onBlur={() => back?.left('top:refresh')}
        >
          Refresh
        </Button>
        {/* Search is the whole home's: none while a chip narrows it. */}
        {isFiltered(filter) ? null : (
          <Button
            size="$4"
            circular
            icon={<Search size={px(22)} />}
            aria-label="Search"
            onPress={() => router.push(SEARCH_HREF)}
            onFocus={() => back?.at('top:search', { first: false, toFirst })}
            onBlur={() => back?.left('top:search')}
          />
        )}
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

function Chip({
  label,
  chosen,
  opens = false,
  onPress,
  onFocus,
  onBlur,
}: {
  label: string;
  chosen: boolean;
  opens?: boolean;
  onPress: () => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <Button
      size="$4"
      rounded="$10"
      borderWidth={0}
      bg={chosen ? CHOSEN.bg : '$color3'}
      color={chosen ? CHOSEN.color : '$color12'}
      {...(opens ? { iconAfter: <ChevronDown size={px(16)} color={chosen ? CHOSEN.color : '$color12'} /> } : {})}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {label}
    </Button>
  );
}
