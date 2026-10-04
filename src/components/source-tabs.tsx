import { EyeOff } from '@tamagui/lucide-icons-2/icons/EyeOff';
import { Lock } from '@tamagui/lucide-icons-2/icons/Lock';
import { useEffect, useId, useRef, type ReactElement } from 'react';
import { ScrollView, type View } from 'react-native';
import { Circle, XStack } from 'tamagui';

import { Button } from '@/components/button';
import { FocusGroup, type FocusGroupHandle } from '@/components/focus-group';
import { focusRoomStyles } from '@/components/remote';
import { useTvBack } from '@/components/tv-back';

export interface SourceTab {
  readonly id: string;
  /** Empty for a tab that is its icon alone, which then says what it is in `name`. */
  readonly label: string;
  readonly icon?: ReactElement;
  /** What it is called aloud, for a tab with no label. */
  readonly name?: string;
  /** A small sign after the label: something to finish, a PIN to enter first, or not in use. */
  readonly marker?: 'attention' | 'locked' | 'off';
}

// How long the remote rests on a tab before it is chosen: a run along the
// tabs passes the ones between, without loading each.
const SETTLE_MS = 250;

/**
 * One tab per choice, as pills — across the top of Videos, and for profiles
 * in forms. With `selectOnFocus`, on a TV, a tab is chosen as the remote rests
 * on it, with no select: moving along the tabs moves through what they show.
 */
export function SourceTabs({
  tabs,
  selected,
  onSelect,
  selectOnFocus = false,
}: {
  tabs: readonly SourceTab[];
  /** None while the choice is still being made. */
  selected?: string | undefined;
  onSelect: (id: string) => void;
  selectOnFocus?: boolean;
}) {
  const settling = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(settling.current), []);
  const rest = (id: string) => {
    clearTimeout(settling.current);
    if (id !== selected) settling.current = setTimeout(() => onSelect(id), SETTLE_MS);
  };
  // Left before it settled — down into the list, say — it is not chosen.
  const leave = () => clearTimeout(settling.current);
  // Each tab's own control on a TV: Back sends the remote to the first, and coming into the row lands on
  // the one chosen — not on whichever is nearest, which choosing on focus would then choose.
  const views = useRef(new Map<string, View>());
  const guide = useRef<FocusGroupHandle>(null);
  useEffect(() => {
    if (!selectOnFocus || selected === undefined) return;
    const chosen = views.current.get(selected);
    if (chosen) guide.current?.setDestinations([chosen]);
  }, [selectOnFocus, selected]);
  const back = useTvBack();
  const row = useId();
  const toFirst = () => views.current.get(tabs[0]?.id ?? '')?.requestTVFocus();
  return (
    <FocusGroup ref={guide}>
      {/* On a TV the focused tab's ring reaches past the row: the scroll view leaves it room, or cuts it off. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={focusRoomStyles.style} contentContainerStyle={focusRoomStyles.contentContainerStyle}>
        <XStack gap="$2" role="tablist">
          {tabs.map((tab, index) => {
            const active = tab.id === selected;
            return (
              <Button
                key={tab.id}
                ref={(view: View | null) => {
                  if (view) views.current.set(tab.id, view);
                  else views.current.delete(tab.id);
                }}
                size="$3"
                rounded="$10"
                role="tab"
                aria-selected={active}
                bg={active ? '$accentBackground' : '$color3'}
                color={active ? '$accentColor' : '$color11'}
                borderWidth={0}
                fontWeight={active ? '600' : '400'}
                onPress={() => onSelect(tab.id)}
                onFocus={() => {
                  if (selectOnFocus) rest(tab.id);
                  back?.at(`${row}:${tab.id}`, { first: index === 0, toFirst });
                }}
                onBlur={() => {
                  if (selectOnFocus) leave();
                  back?.left(`${row}:${tab.id}`);
                }}
                {...(tab.icon ? { icon: tab.icon } : {})}
                {...(tab.name ? { 'aria-label': tab.name } : {})}
                {...(tab.marker === 'locked' ? { iconAfter: <Lock size={12} />, 'aria-label': `${tab.label}, locked` } : {})}
                {...(tab.marker === 'off' ? { iconAfter: <EyeOff size={12} />, 'aria-label': `${tab.label}, not used` } : {})}
                {...(tab.marker === 'attention'
                  ? { iconAfter: <Circle size={7} bg={active ? '$accentColor' : '$orange9'} aria-label="needs attention" /> }
                  : {})}
              >
                {/* An icon alone has no words: an empty string is a bare text node, which Tamagui reports on the web with props LogBox cannot print, and the tab throws. */}
                {tab.label || null}
              </Button>
            );
          })}
        </XStack>
      </ScrollView>
    </FocusGroup>
  );
}
