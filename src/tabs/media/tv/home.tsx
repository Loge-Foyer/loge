import { useState } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';
import { Paragraph, YStack } from 'tamagui';

import { GUTTER, px } from '@/components/density';
import { listNames } from '@/components/labels';
import { SourceNotices } from '@/components/media/source-notices';
import { usePosterWidth } from '@/components/shelf';
import { SnapPoint } from '@/components/snap-point';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import type { HomeFilter } from '@/services/home-filter';

import { MediaEmptyState, SetUpCallout, SetUpScreen } from '../shared/home-states';
import { useMediaHome } from '../shared/use-media-home';
import { rowLayout } from './row-layout';
import { TvRow } from './row';
import { TopBar } from './top-bar';

// The title-safe margin at the top of a TV's screen: where the page starts,
// and where a row the remote moves to is held.
const TOP = px(40);

/**
 * Media on a TV: the top bar, then Continue Watching, what is kept and the
 * profile's rows — each a row of posters whose focused title widens to a
 * scene. The page snaps the row the remote is in to the top as it moves
 * between rows, and holds still for the first, so the top bar stays in view
 * until the remote goes past it. The focus starts on the first card.
 */
export function TvHome() {
  const [filter, setFilter] = useState<HomeFilter>({});
  const home = useMediaHome(filter);
  const reduceMotion = useReduceMotion();
  // The rows' width: the page's, once it is laid out — narrower than the screen beside the tabs' rail.
  const { width: screen } = useWindowDimensions();
  const [pageWidth, setPageWidth] = useState(0);
  const layout = rowLayout(usePosterWidth(), px(16), GUTTER, pageWidth || screen);
  // Where the first row sits under the top bar: the page holds still for it.
  const [firstRowY, setFirstRowY] = useState(0);

  if (!home.ready) return <YStack flex={1} bg="$background" />;
  if (home.sources.length === 0) return home.pending.length > 0 ? <SetUpScreen pending={home.pending} /> : <MediaEmptyState />;
  const firstFilled = home.rows.findIndex((row) => row.items.length > 0);

  return (
    // Insets of its own: the snap scrolls to no offset above 0, so the page's top is in its content.
    <ScrollView
      snapToAlignment="item"
      contentInsetAdjustmentBehavior="never"
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: TOP, paddingBottom: px(120) }}
      onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}
    >
      <SnapPoint offset={TOP}>
        <TopBar filter={filter} kinds={home.kinds} refreshing={home.refreshing} onFilter={setFilter} onRefresh={() => void home.refresh()} />
      </SnapPoint>
      {home.pending.length > 0 || home.errors.length > 0 ? (
        <YStack px={GUTTER} pt="$4" gap="$3">
          {home.pending.map(({ connection }) => (
            <SetUpCallout key={connection.id} connection={connection} />
          ))}
          <SourceNotices errors={home.errors} onRetry={() => void home.refresh()} />
        </YStack>
      ) : null}
      {home.rows.map((row, index) => (
        <SnapPoint
          key={row.row.id}
          offset={index === firstFilled ? firstRowY : TOP}
          {...(index === firstFilled ? { onLayout: (event) => setFirstRowY(event.nativeEvent.layout.y) } : {})}
        >
          <YStack pt="$5">
            <TvRow
              row={row}
              filter={filter}
              layout={layout}
              preferFirst={index === firstFilled}
              reduceMotion={reduceMotion}
              watchFrom={home.watchFrom}
              resumesFrom={home.resumesFrom}
            />
          </YStack>
        </SnapPoint>
      ))}
      {home.cannotList.length > 0 ? (
        <Paragraph px={GUTTER} pt="$5" size="$2" color="$color9">
          {`${listNames(home.cannotList.map((source) => source.connection.label))} ${home.cannotList.length === 1 ? 'is' : 'are'} connected but cannot list titles yet.`}
        </Paragraph>
      ) : null}
    </ScrollView>
  );
}

/** A TV has no header: what a phone keeps there is in the home's top bar. */
export function TvHeaderRight() {
  return null;
}
