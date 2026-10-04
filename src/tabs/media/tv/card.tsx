import type { MediaItem } from '@loge/api';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { useEffect, useState, type Ref } from 'react';
import { Animated, Pressable, type View } from 'react-native';
import { H3, SizableText, Theme, YStack } from 'tamagui';

import { Artwork, ArtworkLogo } from '@/components/artwork';
import { px } from '@/components/density';
import { progressOf, ProgressBar, WatchedBadge } from '@/components/media/badges';
import { CARD_RING } from '@/components/remote';
import { Scrim } from '@/components/scrim';

import type { RowLayout } from './row-layout';

const WIDEN_MS = 180;

/**
 * A card in a TV row: a poster, and once the remote is on it, a scene — the
 * backdrop, a still, the frame it stopped at — with the title's logo, drawn
 * over it and as wide as a scene, while the cards after it are drawn that much
 * further along (`shift`). What the remote reaches is the poster's frame
 * alone, which never moves or grows: everything wider or further along is
 * only drawn so.
 */
export function TvCard({
  ref,
  item,
  layout,
  expanded,
  shift,
  showWatch,
  preferred,
  reduceMotion,
  onFocus,
  onBlur,
  onPress,
  onLongPress,
}: {
  /** The card's own focusable frame, which `requestTVFocus()` sends the remote to. */
  ref?: Ref<View>;
  item: MediaItem;
  layout: RowLayout;
  expanded: boolean;
  shift: number;
  showWatch: boolean;
  preferred: boolean;
  reduceMotion: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const motion = useCardMotion(expanded, shift, reduceMotion);
  const progress = showWatch ? progressOf(item) : undefined;
  const scene = item.images.frame ?? item.images.thumb ?? item.images.backdrop;
  const title = item.type === 'episode' ? item.showTitle || item.title : item.title;
  return (
    <Pressable
      {...(ref ? { ref } : {})}
      onPress={onPress}
      {...(onLongPress ? { onLongPress } : {})}
      hasTVPreferredFocus={preferred}
      accessibilityRole="button"
      accessibilityLabel={title}
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur();
      }}
      style={{ width: layout.poster, height: layout.height }}
    >
      <Animated.View style={{ width: layout.poster, height: layout.height, transform: [{ translateX: motion.shift }] }}>
        <YStack position="relative" width={layout.poster} height={layout.height} rounded="$5" overflow="hidden" bg="$color3" {...(focused && !expanded ? CARD_RING : {})}>
          <Artwork connectionId={item.key.connectionId} image={item.images.poster} width={layout.poster} aspect={2 / 3} label={title} />
          {showWatch && item.watch?.played ? <WatchedBadge /> : null}
          {progress === undefined ? null : <ProgressBar value={progress} />}
        </YStack>
        {expanded ? (
          <Animated.View style={{ position: 'absolute', top: 0, left: 0, width: layout.scene, height: layout.height, opacity: motion.scene }}>
            <YStack position="relative" width={layout.scene} height={layout.height} rounded="$5" overflow="hidden" bg="$color3" {...(focused ? CARD_RING : {})}>
              <Artwork connectionId={item.key.connectionId} image={scene ?? item.images.poster} width={layout.scene} aspect={16 / 9} label={title} rounded="$0" />
              <Theme name="dark">
                <Scrim from="bottom" strength={0.8} />
                <YStack position="absolute" l={px(20)} r={px(20)} b={px(24)}>
                  <ArtworkLogo
                    connectionId={item.key.connectionId}
                    image={item.images.logo}
                    width={Math.round(layout.scene * 0.5)}
                    height={Math.round(layout.height * 0.28)}
                    label={title}
                    fallback={
                      <H3 size="$8" color="$color12" numberOfLines={2}>
                        {title}
                      </H3>
                    }
                  />
                </YStack>
              </Theme>
              {progress === undefined ? null : <ProgressBar value={progress} />}
            </YStack>
          </Animated.View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

/** The card at the end of a long row, a poster's size: everything else of the row, as a grid. */
export function MoreCard({
  layout,
  shift,
  reduceMotion,
  onFocus,
  onBlur,
  onPress,
}: {
  layout: RowLayout;
  shift: number;
  reduceMotion: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const motion = useCardMotion(false, shift, reduceMotion);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="More of this row"
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur();
      }}
      style={{ width: layout.poster, height: layout.height }}
    >
      <Animated.View style={{ transform: [{ translateX: motion.shift }] }}>
        <YStack
          width={layout.poster}
          height={layout.height}
          rounded="$5"
          borderWidth={2}
          borderColor={focused ? '$accent10' : '$color7'}
          items="center"
          justify="center"
          gap="$2"
          {...(focused ? CARD_RING : {})}
        >
          <Plus size={px(40)} color={focused ? '$color12' : '$color10'} />
          <SizableText size="$5" fontWeight="600" color={focused ? '$color12' : '$color10'}>
            More…
          </SizableText>
        </YStack>
      </Animated.View>
    </Pressable>
  );
}

/**
 * How far a card is drawn along, and its scene's fade, each on the native
 * driver and each on its own: animations run together stop together, and a
 * scene taken away as its card closes has nothing left to fade, which once
 * left the card that had the focus wide, and in the way of the next.
 */
function useCardMotion(expanded: boolean, shift: number, reduceMotion: boolean) {
  const [scene] = useState(() => new Animated.Value(expanded ? 1 : 0));
  const [moved] = useState(() => new Animated.Value(shift));
  useEffect(() => {
    if (reduceMotion) {
      moved.setValue(shift);
      return undefined;
    }
    const run = Animated.timing(moved, { toValue: shift, duration: WIDEN_MS, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [shift, reduceMotion, moved]);
  useEffect(() => {
    // The scene is drawn only while the card is open: it fades in as it is put in, and goes with it.
    if (!expanded || reduceMotion) {
      scene.setValue(expanded ? 1 : 0);
      return undefined;
    }
    scene.setValue(0);
    const run = Animated.timing(scene, { toValue: 1, duration: WIDEN_MS, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [expanded, reduceMotion, scene]);
  return { scene, shift: moved };
}
