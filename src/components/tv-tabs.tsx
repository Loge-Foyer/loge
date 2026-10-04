import { Film } from '@tamagui/lucide-icons-2/icons/Film';
import { Settings } from '@tamagui/lucide-icons-2/icons/Settings';
import { SquarePlay } from '@tamagui/lucide-icons-2/icons/SquarePlay';
import { Tv } from '@tamagui/lucide-icons-2/icons/Tv';
import { LinearGradient } from 'expo-linear-gradient';
import { TabList, TabSlot, TabTrigger, Tabs, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { SizableText, useTheme, XStack, YStack } from 'tamagui';

import { AppMark } from './app-mark';
import { clearOf } from './colour';
import { GUTTER, px } from './density';
import { FocusGroup, type FocusGroupHandle } from './focus-group';
import { CHOSEN } from './settings-list';
import { TvBackContext, type TvBack, type TvSpot } from './tv-back';
import { useBackLayers } from '@/hooks/use-back-layers';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useRemoteKeys } from '@/hooks/use-remote-keys';

// Where the symbols' column starts, and how wide it is.
const LEFT = px(40);
const CELL = px(48);
/** The rail's width while the remote is in a tab: its symbols, on the page's own colour. */
const RAIL = LEFT + CELL + px(8);
// Where a tab's page starts: so that its own margin, the TV's title-safe one,
// puts what it shows just clear of the rail.
const PAGE = RAIL - GUTTER + px(16);
// The rail's width while the remote is in it, words and all, drawn over the page.
const OPEN = LEFT + CELL + px(200);
const ITEM = px(48);
const ICON = px(24);
const OPEN_MS = 160;

type TabIcon = typeof Film;
// A symbol's colour: the accent's own on the focused pill, the accent for the tab shown, grey otherwise.
type IconColor = '$accentColor' | '$accent11' | '$color11';

/**
 * The tabs on a TV, down the left rather than across the top, where each tab
 * has its own controls: Loge's icon at the top, then Media, Videos, Live and
 * Settings as a column of symbols while the remote is in a page, opening with
 * their words, over the page on a veil, while it is in the rail. UIKit's tab
 * bar cannot do it — on tvOS a tab bar controller has no sidebar — so this is
 * expo-router's own headless tabs, as the browser's top bar is. Select
 * changes the tab and sends the remote into it, so the rail closes behind it.
 * Left from a page's first control reaches the rail; right goes back to what
 * the remote left in the page.
 *
 * Back on a tab's first screen walks outwards: to the first control of the
 * row, list or column the remote is in; then to the rail; then, with the rail
 * open, out of the app. Menu is held for the app only until the rail is
 * open, so the last press is the system's own — `exitApp` does nothing on
 * tvOS (`components/tv-back.tsx`).
 */
export function TvTabs() {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReduceMotion();
  const page = useRef<FocusGroupHandle>(null);
  const rail = useRef<FocusGroupHandle>(null);
  // Where the remote is, as the control it is on last said; and how many tabs' first screens are in front.
  const spot = useRef<{ readonly owner: unknown; readonly spot: TvSpot } | undefined>(undefined);
  const [roots, setRoots] = useState(0);
  const back = useMemo<TvBack>(
    () => ({
      at: (owner, here) => {
        spot.current = { owner, spot: here };
      },
      left: (owner) => {
        if (spot.current?.owner === owner) spot.current = undefined;
      },
      root: (inFront) => {
        spot.current = undefined;
        setRoots((count) => count + (inFront ? 1 : -1));
      },
    }),
    [],
  );
  // Right from the open rail goes back to what the remote left in the page, and the rail closes behind it:
  // left to the focus engine, it looked past the rail drawn over the page and went somewhere else, or nowhere.
  useRemoteKeys((key) => {
    if (key === 'right' && open) page.current?.requestTVFocus();
  });
  useBackLayers(
    roots > 0 && !open
      ? () => {
          const here = spot.current?.spot;
          if (here && !here.first) here.toFirst();
          else rail.current?.requestTVFocus();
        }
      : undefined,
  );
  // Counts the tabs chosen: each sends the focus into the page once that tab is drawn.
  const [chosen, setChosen] = useState(0);
  useEffect(() => {
    if (chosen > 0) page.current?.requestTVFocus();
  }, [chosen]);
  const choose = () => setChosen((count) => count + 1);
  // A page that names no first control — Live — leaves the system to place the focus at launch, and it
  // takes the rail, top left. Until the remote has been in a page once, the rail sends it there.
  const settled = useRef(false);
  const openRail = (next: boolean) => {
    if (next && !settled.current) {
      settled.current = true;
      page.current?.requestTVFocus();
      return;
    }
    setOpen(next);
  };
  return (
    <TvBackContext value={back}>
      <Tabs>
        <XStack flex={1} bg="$background">
          <YStack width={PAGE} />
          <FocusGroup
            ref={page}
            onFocusEnter={() => {
              settled.current = true;
            }}
            style={{ flex: 1 }}
          >
            <TabSlot style={{ flex: 1 }} />
          </FocusGroup>
        </XStack>
        <TabList asChild>
          <Rail railRef={rail} open={open} reduceMotion={reduceMotion} onOpen={openRail}>
            <TabTrigger name="media" href="/media" asChild>
              <RailTab icon={Film} label="Media" open={open} onChosen={choose} />
            </TabTrigger>
            <TabTrigger name="videos" href="/videos" asChild>
              <RailTab icon={SquarePlay} label="Videos" open={open} onChosen={choose} />
            </TabTrigger>
            <TabTrigger name="live" href="/live" asChild>
              <RailTab icon={Tv} label="Live" open={open} onChosen={choose} />
            </TabTrigger>
            <TabTrigger name="settings" href="/settings" asChild>
              <RailTab icon={Settings} label="Settings" open={open} onChosen={choose} />
            </TabTrigger>
          </Rail>
        </TabList>
      </Tabs>
    </TvBackContext>
  );
}

/** The rail itself: its column, the veil behind it while it is open, and its width, animated between the two. */
function Rail({
  railRef,
  open,
  reduceMotion,
  onOpen,
  children,
}: TabListProps & { railRef: RefObject<FocusGroupHandle | null>; open: boolean; reduceMotion: boolean; onOpen: (open: boolean) => void }) {
  const theme = useTheme();
  const solid = String(theme.background.val);
  const [width] = useState(() => new Animated.Value(RAIL));
  const [veil] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const target = { width: open ? OPEN : RAIL, veil: open ? 1 : 0 };
    if (reduceMotion) {
      width.setValue(target.width);
      veil.setValue(target.veil);
      return undefined;
    }
    // The width is layout, which the native driver cannot animate; the veil's fade can.
    const run = Animated.parallel([
      Animated.timing(width, { toValue: target.width, duration: OPEN_MS, useNativeDriver: false }),
      Animated.timing(veil, { toValue: target.veil, duration: OPEN_MS, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
  }, [open, reduceMotion, width, veil]);

  return (
    <>
      <Animated.View style={[styles.edge, { width: Math.round(OPEN * 1.6), opacity: veil, pointerEvents: 'none' }]}>
        <LinearGradient
          colors={[solid, solid, clearOf(solid)]}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View style={[styles.edge, { width, overflow: 'hidden', backgroundColor: solid }]}>
        <FocusGroup ref={railRef} traps={['right']} onFocusEnter={() => onOpen(true)} onFocusLeave={() => onOpen(false)} style={{ flex: 1 }}>
          <YStack flex={1} pl={LEFT} pr={px(8)} pt={px(40)} pb={px(40)}>
            {/* Loge's own icon heads the rail, in the symbols' column; the remote never lands on it. */}
            <YStack width={CELL} items="center">
              <AppMark size={px(30)} />
            </YStack>
            <YStack flex={1} gap="$1.5" justify="center" role="tablist">
              {children}
            </YStack>
          </YStack>
        </FocusGroup>
      </Animated.View>
    </>
  );
}

/**
 * One tab in the rail: its symbol, and its name while the rail is open — a
 * pill in the accent while the remote is on it, the accent's colour while it
 * is the tab shown.
 */
function RailTab({
  isFocused,
  icon: Icon,
  label,
  open,
  onPress,
  onChosen,
}: TabTriggerSlotProps & { icon: TabIcon; label: string; open: boolean; onChosen: () => void }) {
  const [focused, setFocused] = useState(false);
  const shown = isFocused ?? false;
  const color: IconColor = focused ? '$accentColor' : shown ? '$accent11' : '$color11';
  return (
    <Pressable
      onPress={(event) => {
        onPress?.(event);
        onChosen();
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: shown }}
    >
      <XStack height={ITEM} items="center" rounded="$10" bg={focused ? CHOSEN.bg : 'transparent'}>
        <YStack width={CELL} items="center">
          <Icon size={ICON} color={color} />
        </YStack>
        {open ? (
          <SizableText
            size="$6"
            fontWeight={shown || focused ? '700' : '500'}
            color={focused ? CHOSEN.color : shown ? '$accent11' : '$color12'}
            numberOfLines={1}
            pr="$4"
          >
            {label}
          </SizableText>
        ) : null}
      </XStack>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', top: 0, bottom: 0, left: 0 },
});
