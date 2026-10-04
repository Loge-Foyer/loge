import type { MediaItem } from '@loge/api';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { SizableText, YStack } from 'tamagui';

import { px } from '@/components/density';
import { playHref, titleHref } from '@/components/media/item-link';
import { RowTitle } from '@/components/media/row-title';
import { SnapPoint } from '@/components/snap-point';
import { useKeptWatch } from '@/hooks/use-kept-watch';
import type { HomeFilter } from '@/services/home-filter';

import { browseHref } from '../shared/links';
import { resumeAtOf } from '../shared/title-actions';
import { tvInfoLines } from '../shared/title-meta';
import type { MediaHomeRow } from '../shared/use-media-home';
import { MoreCard, TvCard } from './card';
import { shiftOf, TV_ROW_CARDS, type RowLayout } from './row-layout';

// Room for the ring around a card, which is drawn outside it.
const RING = px(8);

/**
 * One of the home's rows on a TV: its title in grey capitals, which the remote
 * never lands on; its titles side by side, the one the remote is on drawn as a
 * scene at the row's margin; after twenty, a card for the rest; and beneath,
 * what the focused one is, in two lines that always keep their room so the
 * row's height never changes as the focus moves.
 *
 * Right and left move the row, not the focus: its scroll view snaps the
 * focused card's slot to the margin, in one motion with the focus engine's
 * own, and keeps room after the last for it to get there. Up and down land on
 * the card at the margin — the one last used, since the row stays where it
 * was. It is no focus group: a focus guide over the whole row was the second
 * thing that could send the remote to its end.
 */
export function TvRow({
  row,
  filter,
  layout,
  preferFirst,
  reduceMotion,
  watchFrom,
  resumesFrom,
}: {
  row: MediaHomeRow;
  filter: HomeFilter;
  layout: RowLayout;
  preferFirst: boolean;
  reduceMotion: boolean;
  watchFrom: (item: MediaItem) => boolean;
  resumesFrom: (item: MediaItem) => boolean;
}) {
  const [inside, setInside] = useState(false);
  const [focused, setFocused] = useState(0);
  // The remote leaves one card before it lands on the next: the row waits a moment before it is left.
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leaving.current), []);
  const enter = (index: number) => {
    clearTimeout(leaving.current);
    setFocused(index);
    setInside(true);
  };
  const leave = () => {
    clearTimeout(leaving.current);
    leaving.current = setTimeout(() => setInside(false), 0);
  };
  const withKept = useKeptWatch(row.items);
  const cards = row.items.slice(0, TV_ROW_CARDS).map(withKept);
  const more = row.row.type === 'titles' && row.items.length > TV_ROW_CARDS;
  const current = inside ? focused : undefined;
  const info = inside ? cards[focused] : undefined;
  const continuing = row.row.type === 'continue';
  return (
    <YStack gap="$2">
      <YStack px={layout.inset}>
        <RowTitle>{row.title}</RowTitle>
      </YStack>
      <ScrollView
        horizontal
        snapToAlignment="item"
        snapToItemPadding={layout.inset}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingLeft: layout.inset, paddingRight: layout.trailing, paddingVertical: RING }}
      >
        {cards.map((item, index) => (
          <SnapPoint key={`${item.key.connectionId}|${item.key.externalId}`} align="start" style={{ width: layout.slot }}>
            <TvCard
              item={item}
              layout={layout}
              expanded={current === index}
              shift={shiftOf(layout, index, current)}
              showWatch={row.row.type !== 'downloads' && watchFrom(item)}
              preferred={preferFirst && index === 0}
              reduceMotion={reduceMotion}
              onFocus={() => enter(index)}
              onBlur={leave}
              // Continue Watching plays where it stopped; holding select opens its page instead.
              onPress={() => {
                const startMs = resumeAtOf(item);
                router.push(continuing && resumesFrom(item) ? playHref(item.key, startMs ? { startMs } : {}) : titleHref(item));
              }}
              {...(continuing ? { onLongPress: () => router.push(titleHref(item)) } : {})}
            />
          </SnapPoint>
        ))}
        {more ? (
          <SnapPoint align="start" style={{ width: layout.slot }}>
            <MoreCard
              layout={layout}
              shift={shiftOf(layout, cards.length, current)}
              reduceMotion={reduceMotion}
              onFocus={() => enter(cards.length)}
              onBlur={leave}
              onPress={() => router.push(browseHref(row.row.id, filter))}
            />
          </SnapPoint>
        ) : null}
      </ScrollView>
      <InfoSlot item={info} inset={layout.inset} />
    </YStack>
  );
}

/** Two lines about the card the remote is on: an episode's code and name, how long is left. Empty, but kept, otherwise. */
function InfoSlot({ item, inset }: { item: MediaItem | undefined; inset: number }) {
  const [first, second] = item ? tvInfoLines(item) : ['', ''];
  return (
    <YStack px={inset} height={px(56)} gap="$1" justify="flex-start">
      <SizableText size="$3" color="$color10" numberOfLines={1}>
        {first || ' '}
      </SizableText>
      <SizableText size="$4" fontWeight="600" color="$color12" numberOfLines={1}>
        {second || ' '}
      </SizableText>
    </YStack>
  );
}
