import type { ContentKind } from '@loge/api';
import { ChevronDown } from '@tamagui/lucide-icons-2/icons/ChevronDown';
import { X } from '@tamagui/lucide-icons-2/icons/X';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { Button } from '@/components/button';
import { GUTTER, px } from '@/components/density';
import { CONTENT_KIND_LABELS } from '@/components/labels';
import { OverlayPicker } from '@/components/overlay-picker';
import { CHOSEN } from '@/components/settings-list';
import { useGenres } from '@/hooks/use-media';
import type { HomeFilter } from '@/services/home-filter';

import { chipsFor } from '../shared/filter-chips';

// "All categories" in the picker: no genre, which no source names.
const EVERY_GENRE = '';

/**
 * The chips over the home: Shows, Movies — Anime where a source brings it —
 * and Categories, which opens every genre the sources file their titles under.
 * Choosing one narrows the whole home; ✕ clears it.
 */
export function FilterBar({
  filter,
  kinds,
  onChange,
}: {
  filter: HomeFilter;
  /** The kinds Media's sources bring. */
  kinds: readonly ContentKind[];
  onChange: (filter: HomeFilter) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const genres = useGenres(filter.kind === undefined ? kinds : [filter.kind], choosing || filter.genre !== undefined);
  const options = [{ id: EVERY_GENRE, label: 'All categories' }, ...(genres.data?.genres ?? []).map((genre) => ({ id: genre, label: genre }))];
  const chips = chipsFor(filter, kinds);
  if (kinds.length === 0) return null;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: px(8) }}>
        {chips.map((chip) => {
          if (chip.type === 'clear') {
            return <Button key="clear" size="$3" circular chromeless borderWidth={1} borderColor="$color7" icon={X} aria-label="Show everything" onPress={() => onChange({})} />;
          }
          if (chip.type === 'kind') {
            return (
              <Pill
                key={chip.kind}
                label={CONTENT_KIND_LABELS[chip.kind]}
                chosen={chip.chosen}
                onPress={() => {
                  const { kind: _kind, ...rest } = filter;
                  onChange(chip.chosen ? rest : { ...filter, kind: chip.kind });
                }}
              />
            );
          }
          return <Pill key="categories" label={chip.genre ?? 'Categories'} chosen={chip.genre !== undefined} opens onPress={() => setChoosing(true)} />;
        })}
      </ScrollView>
      <OverlayPicker
        open={choosing}
        label="Categories"
        options={options}
        selected={filter.genre ?? EVERY_GENRE}
        onSelect={(genre) => {
          const { genre: _genre, ...rest } = filter;
          onChange(genre === EVERY_GENRE ? rest : { ...rest, genre });
        }}
        onClose={() => setChoosing(false)}
      />
    </>
  );
}

function Pill({ label, chosen, opens = false, onPress }: { label: string; chosen: boolean; opens?: boolean; onPress: () => void }) {
  return (
    <Button
      size="$3"
      rounded="$10"
      borderWidth={1}
      borderColor={chosen ? 'transparent' : '$color7'}
      bg={chosen ? CHOSEN.bg : 'transparent'}
      color={chosen ? CHOSEN.color : '$color12'}
      pressStyle={{ bg: chosen ? CHOSEN.bg : '$color3' }}
      {...(opens ? { iconAfter: <ChevronDown size={px(14)} color={chosen ? CHOSEN.color : '$color12'} /> } : {})}
      aria-label={opens ? `${label}, choose a category` : label}
      onPress={onPress}
    >
      {label}
    </Button>
  );
}
