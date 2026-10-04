import { RefreshCw } from '@tamagui/lucide-icons-2/icons/RefreshCw';
import { Search } from '@tamagui/lucide-icons-2/icons/Search';
import { SlidersHorizontal } from '@tamagui/lucide-icons-2/icons/SlidersHorizontal';
import { Link, Stack, useNavigation } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useLayoutEffect, useState } from 'react';
import { Animated, Platform, RefreshControl, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Paragraph, XStack, YStack, useMedia, useTheme } from 'tamagui';

import { AppMark } from '@/components/app-mark';
import { Button } from '@/components/button';
import { CastButton } from '@/components/cast-button';
import { GUTTER, px } from '@/components/density';
import { Glow } from '@/components/glow';
import { SYSTEM_GLASS } from '@/components/header-button';
import { listNames } from '@/components/labels';
import { SourceNotices } from '@/components/media/source-notices';
import { useLandscapeWidth, usePosterWidth } from '@/components/shelf';
import { useAppSettings } from '@/hooks/use-app-settings';
import { APP_DEFAULTS } from '@/services/app-settings';
import type { HomeFilter } from '@/services/home-filter';

import { heroOf } from '../shared/hero';
import { MediaEmptyState, SetUpCallout, SetUpScreen } from '../shared/home-states';
import { SEARCH_HREF } from '../shared/links';
import { useMediaHome } from '../shared/use-media-home';
import { FilterBar } from './filter-bar';
import { HeroCard } from './hero-card';
import { MobileRow } from './row';

const isWeb = process.env.EXPO_OS === 'web';
// How far the page scrolls before the glow has gone and the bar wears its colour.
const GLOW_FADE = 240;
const SCROLLED = 4;

/**
 * Media on a phone, a tablet and in a browser: the profile's own home. Over a
 * glow of colour, the chips that narrow it, then one title large, then
 * Continue Watching, what this device keeps, and the profile's rows — in grey
 * capitals, each opening its grid — all of it narrowed to what the chips say.
 */
export function MobileHome() {
  const [filter, setFilter] = useState<HomeFilter>({});
  const home = useMediaHome(filter);
  const settings = useAppSettings().data ?? APP_DEFAULTS;
  const navigation = useNavigation();
  const theme = useTheme();
  const wide = useMedia().md;
  const { width, height } = useWindowDimensions();
  const posterWidth = usePosterWidth();
  const landscapeWidth = useLandscapeWidth();
  const header = useHeaderHeight();
  const [scrollY] = useState(() => new Animated.Value(0));
  const [scrolled, setScrolled] = useState(false);

  // Android's bar is see-through over the glow, and takes its colour once the page runs under it.
  useLayoutEffect(() => {
    if (Platform.OS !== 'android') return;
    navigation.setOptions({ headerStyle: { backgroundColor: scrolled ? String(theme.color3.val) : 'transparent' } });
  }, [navigation, scrolled, theme]);

  // The same header in every state: no title, the app's icon at its left, Search and the profile at its right.
  // It is see-through only over the glow; a page with nothing behind it keeps the bar's own.
  const bar = (overGlow: boolean) => (
    <Stack.Screen
      options={{
        title: '',
        headerLargeTitleEnabled: false,
        headerLeft: () => <AppMark />,
        // On iOS 26 a header item sits in the system's glass unless it asks not to; the icon is no button.
        unstable_headerLeftItems: () => [{ type: 'custom', element: <AppMark />, hidesSharedBackground: true }],
        headerTransparent: overGlow,
        // From iOS 26 the system's own edge effect; before it a blur once the page runs under the bar.
        ...(Platform.OS === 'ios' ? { headerBlurEffect: overGlow && !SYSTEM_GLASS ? ('systemChromeMaterial' as const) : ('none' as const) } : {}),
      }}
    />
  );

  if (!home.ready) return <YStack flex={1} bg="$background">{bar(true)}</YStack>;
  if (home.sources.length === 0) {
    return (
      <>
        {bar(false)}
        {home.pending.length > 0 ? <SetUpScreen pending={home.pending} /> : <MediaEmptyState />}
      </>
    );
  }

  const hero = heroOf(home.rows.filter((row) => row.row.type === 'titles').map((row) => row.items));
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = event.nativeEvent.contentOffset.y + (Platform.OS === 'ios' ? header : 0) > SCROLLED;
    if (next !== scrolled) setScrolled(next);
  };

  return (
    <YStack flex={1} bg="$background">
      {bar(true)}
      {settings.homeGlow ? (
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: height * 0.55,
            pointerEvents: 'none',
            opacity: scrollY.interpolate({ inputRange: [0, GLOW_FADE], outputRange: [1, 0], extrapolate: 'clamp' }),
          }}
        >
          <Glow colour={settings.glowColour} height={height * 0.55} />
        </Animated.View>
      ) : null}
      <Animated.ScrollView
        contentInsetAdjustmentBehavior="automatic"
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: !isWeb, listener: onScroll })}
        contentContainerStyle={{ paddingTop: Platform.OS === 'android' ? header : 0, paddingBottom: px(48) }}
        {...(isWeb
          ? {}
          : {
              refreshControl: (
                <RefreshControl
                  refreshing={home.refreshing}
                  onRefresh={() => void home.refresh()}
                  tintColor={String(theme.color10.val)}
                  progressViewOffset={Platform.OS === 'android' ? header : 0}
                />
              ),
            })}
      >
        <YStack gap="$5" pt="$2">
          {isWeb ? (
            // A browser's top bar is its header: the icon and Search are the page's own.
            <XStack px={GUTTER} pt="$3" items="center" justify="space-between">
              <AppMark size={36} />
              <XStack gap="$2" items="center">
                <CastButton />
                <SearchButton />
              </XStack>
            </XStack>
          ) : null}
          <FilterBar filter={filter} kinds={home.kinds} onChange={setFilter} />
          {home.pending.length > 0 || home.errors.length > 0 ? (
            <YStack px={GUTTER} gap="$3">
              {home.pending.map(({ connection }) => (
                <SetUpCallout key={connection.id} connection={connection} />
              ))}
              <SourceNotices errors={home.errors} onRetry={() => void home.refresh()} />
            </YStack>
          ) : null}
          {hero ? <HeroCard key={`${hero.key.connectionId}|${hero.key.externalId}`} item={hero} width={Math.min(width - 2 * GUTTER, wide ? px(900) : px(420))} canPlay={home.playsFrom(hero)} /> : null}
          {home.rows.map((row) => (
            <MobileRow
              key={row.row.id}
              row={row}
              filter={filter}
              posterWidth={posterWidth}
              landscapeWidth={landscapeWidth}
              watchFrom={home.watchFrom}
              resumesFrom={home.resumesFrom}
            />
          ))}
          {home.cannotList.length > 0 ? (
            <Paragraph px={GUTTER} size="$2" color="$color9">
              {`${listNames(home.cannotList.map((source) => source.connection.label))} ${home.cannotList.length === 1 ? 'is' : 'are'} connected but cannot list titles yet.`}
            </Paragraph>
          ) : null}
          <XStack px={GUTTER} gap="$2" justify="center">
            <Link href="/customize-home" asChild>
              <Button size="$3" chromeless icon={<SlidersHorizontal size={px(16)} color="$color11" />} color="$color11">
                Customize home
              </Button>
            </Link>
            {isWeb ? (
              // A browser cannot pull to refresh.
              <Button size="$3" chromeless icon={RefreshCw} color="$color11" disabled={home.refreshing} onPress={() => void home.refresh()}>
                Refresh
              </Button>
            ) : null}
          </XStack>
        </YStack>
      </Animated.ScrollView>
    </YStack>
  );
}

/** Media's search: every film, series and anime the sources hold. */
export function SearchButton() {
  return (
    <Link href={SEARCH_HREF} asChild>
      <Button size="$3" circular chromeless aria-label="Search" icon={<Search size={20} color="$color11" />} />
    </Link>
  );
}

/** What sits beside the profile at the right of the home's header: Cast, once there is casting, and Search. */
export function MobileHeaderRight() {
  return (
    <XStack gap="$1" items="center">
      <CastButton />
      <SearchButton />
    </XStack>
  );
}
