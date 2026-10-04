import { segmentAt, type AudioTrack, type Channel, type Chapter, type ConnectionId, type Episode, type GlobalMediaKey, type MediaItem, type MediaPlayer, type MediaSegment, type PluginId, type SubtitleTrack } from '@loge/api';
import type { PlayerView } from '@loge/player-kit';
import { AudioLines } from '@tamagui/lucide-icons-2/icons/AudioLines';
import { Captions } from '@tamagui/lucide-icons-2/icons/Captions';
import { ChevronsLeft } from '@tamagui/lucide-icons-2/icons/ChevronsLeft';
import { ChevronsRight } from '@tamagui/lucide-icons-2/icons/ChevronsRight';
import { Sun } from '@tamagui/lucide-icons-2/icons/Sun';
import { Volume2 } from '@tamagui/lucide-icons-2/icons/Volume2';
import { VolumeX } from '@tamagui/lucide-icons-2/icons/VolumeX';
import { Gauge } from '@tamagui/lucide-icons-2/icons/Gauge';
import { List } from '@tamagui/lucide-icons-2/icons/List';
import { SkipForward } from '@tamagui/lucide-icons-2/icons/SkipForward';
import { ChevronDown } from '@tamagui/lucide-icons-2/icons/ChevronDown';
import { ChevronUp } from '@tamagui/lucide-icons-2/icons/ChevronUp';
import { Pause } from '@tamagui/lucide-icons-2/icons/Pause';
import { Play } from '@tamagui/lucide-icons-2/icons/Play';
import { RotateCcw } from '@tamagui/lucide-icons-2/icons/RotateCcw';
import { RotateCw } from '@tamagui/lucide-icons-2/icons/RotateCw';
import { X } from '@tamagui/lucide-icons-2/icons/X';
import { router, useFocusEffect, useIsFocused, useNavigation } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Animated, AppState, BackHandler, Easing, PanResponder, Pressable, ScrollView, StyleSheet, View, type PanResponderInstance } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SizableText, Slider, Spinner, Theme, XStack, YStack } from 'tamagui';

import { px } from '@/components/density';
import { Button } from '@/components/button';
import { clockTime, describeMissing, episodeCode } from '@/components/labels';
import { ChannelBanner } from '@/components/media/channel-banner';
import { isFavorites, liveHref, playHref } from '@/components/media/item-link';
import { FocusGroup } from '@/components/focus-group';
import { FOCUSED, isHandheld, isTV, useRemoteFocus } from '@/components/remote';
import { PrimaryButton } from '@/components/primary-button';
import { useAppSettings } from '@/hooks/use-app-settings';
import { nowAndNext, useGuide, useLineupAround, useNow } from '@/hooks/use-live';
import { useLiveRecovery } from '@/hooks/use-live-recovery';
import { useItem } from '@/hooks/use-media';
import { useNextEpisode, usePlaybackPlan, usePlaybackReports, usePlayer, usePlayerOrientation, type PlayerSnapshot } from '@/hooks/use-playback';
import { APP_DEFAULTS } from '@/services/app-settings';
import type { PlayerButton, PlayerJump, PlayerSlider } from '@/services/ports';
import { useServices } from '@/hooks/services-context';
import { useRemoteKeys } from '@/hooks/use-remote-keys';
import { ChannelPanel } from '@/screens/player-channels';
import { backStep, liveOverlay, zapTarget, type BackStep, type LiveOverlayState, type PlayerLayers } from '@/screens/player-layers';
import { categoryHref } from '@/screens/settings/plugin-route';

const HIDE_AFTER_MS = 3_500;
/** How long a TV's banner stays once the channel plays, or after a press of right. */
const BANNER_MS = 5_000;
/** How long a run of up and down presses waits for the next before it tunes: each tune is a new link and a new stream. */
const ZAP_SETTLE_MS = 500;
/** How long a remote's left or right waits for a second press: a click comes slower than a finger's tap. */
const DOUBLE_PRESS_MS = 400;
/** How bright a double tap's side flashes at its peak: barely, a white veil over the picture. */
const FLASH_ALPHA = 0.04;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/**
 * Full screen, over the tabs: the chosen player's own view underneath, the
 * app's controls on top — the same for every engine. Where no player here
 * can play the item, it says which kind would.
 */
export function PlayerScreen({
  connectionId,
  itemId,
  startMs,
  live,
  player,
}: {
  connectionId: ConnectionId;
  itemId: string;
  startMs?: number;
  /** A channel: no item to read, nothing to report, and the channels of its group either side. */
  live?: { readonly title: string; readonly group?: string };
  /** "Play with…": the player the user picked, for this item and the episodes after it. */
  player?: PluginId;
}) {
  usePlayerOrientation();
  const key = { connectionId, externalId: itemId };
  const detail = useItem(key, !live);
  const item = live ? undefined : detail.data?.detail.item;
  const { plan, error: planError, retry } = usePlaybackPlan(live ? key : item?.key, {
    ...(startMs === undefined ? {} : { startMs }),
    ...(live ? { live: true } : {}),
    ...(player ? { player } : {}),
  });
  const report = usePlaybackReports(item, live !== undefined, startMs);
  const { controller, snapshot } = usePlayer(plan, connectionId, report);
  const focused = useIsFocused();
  // A channel whose stream stopped comes back by itself, and says so, rather than showing a failure.
  const recovering = useLiveRecovery({ live: live !== undefined, state: planError ? 'failed' : snapshot.state, error: snapshot.error ?? planError, focused, retry });
  const layersRef = useRef<LayerControl>(undefined);
  usePlayerBack(layersRef);
  const shrunk = usePlayerLeaving(controller, live !== undefined, snapshot.state === 'playing');
  const { playback } = useServices();
  const View = plan?.kind === 'play' ? playback.view(plan.player) : undefined;
  const next = useNextEpisode(item?.type === 'episode' ? item : undefined);

  const problem = recovering
    ? undefined
    : !live && detail.error
    ? detail.error.message
    : planError
      ? `This could not be started: ${planError.message}`
      : plan?.kind === 'none'
        ? describeMissing(plan.needs, plan.source)
        : plan?.kind === 'no-player'
          ? 'Every player is switched off on this device.'
          : snapshot.state === 'failed'
            ? (snapshot.error?.message ?? 'This stopped playing.')
            : live && snapshot.state === 'ended'
              ? // A provider plays one stream per subscription line, and ends the one before when another starts.
                'The channel stopped. A subscription often plays one stream at a time, so another device may have started playing on it.'
              : undefined;

  return (
    // Its own provider: a full-screen modal is measured apart from the screen
    // beneath it, so the root one keeps a turned phone's old insets. Dark in
    // either scheme: it is drawn over a film.
    <SafeAreaProvider>
      <Theme name="dark">
        <YStack flex={1} bg="black">
          <StatusBar hidden />
          {View && controller ? <Surface view={View} controller={controller} /> : null}
          {shrunk ? null : problem ? (
            <Notice
              message={problem}
              {...(plan?.kind === 'none' || plan?.kind === 'no-player' ? { players: true } : { onRetry: retry })}
            />
          ) : (
            <Controls
              item={item}
              controller={controller}
              snapshot={snapshot}
              starting={!plan || !controller}
              {...(plan?.kind === 'play' && plan.descriptor.chapters ? { chapters: plan.descriptor.chapters } : {})}
              {...(plan?.kind === 'play' && plan.descriptor.segments ? { segments: plan.descriptor.segments } : {})}
              {...(next.data ? { next: next.data } : {})}
              {...(player ? { player } : {})}
              {...(live ? { live: { channel: key, title: live.title, ...(live.group ? { group: live.group } : {}) } } : {})}
              recovering={recovering}
              controlRef={layersRef}
            />
          )}
        </YStack>
      </Theme>
    </SafeAreaProvider>
  );
}

/** The chosen player's own view, which draws its engine's pictures. */
function Surface({ view: View, controller }: { view: PlayerView; controller: MediaPlayer }) {
  return <View player={controller} style={StyleSheet.absoluteFill} fit="contain" />;
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** What the player's top layers are, and how to close one: `Controls` keeps it current. */
interface LayerControl {
  readonly layers: PlayerLayers;
  close(step: Exclude<BackStep, 'leave'>): void;
}

/** The native stack's own event, which the generic navigation type does not list. */
type TransitionEvents = { addListener(type: 'transitionEnd', listener: (event: { readonly data: { readonly closing: boolean } }) => void): () => void };

/**
 * Back closes what is on top — the channel list, a panel, then on a TV the
 * controls and the banner — and only then the player (`backStep`). Android's
 * Back reaches here as it is; an Apple TV's Menu only while it is held for the
 * app (`tvMenu`), since UIKit pops a pushed screen before the app hears it. It
 * is held while the player is in front, and taken again after each transition
 * and on coming back to the app, which re-arm UIKit's own.
 */
function usePlayerBack(controlRef: RefObject<LayerControl | undefined>) {
  const { tvMenu } = useServices();
  const navigation = useNavigation() as unknown as TransitionEvents;
  useFocusEffect(
    useCallback(() => {
      const release = tvMenu.hold();
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        const step = backStep(controlRef.current?.layers, isTV);
        if (step === 'leave') close();
        else controlRef.current?.close(step);
        return true;
      });
      const stopTransition = navigation.addListener('transitionEnd', (event) => {
        if (!event.data.closing) tvMenu.refresh();
      });
      const active = AppState.addEventListener('change', (state) => {
        if (state === 'active') tvMenu.refresh();
      });
      return () => {
        back.remove();
        stopTransition();
        active.remove();
        release();
      };
    }, [tvMenu, navigation, controlRef]),
  );
}

function Controls({
  item,
  controller,
  snapshot,
  starting,
  chapters,
  segments,
  next,
  player,
  live,
  recovering,
  controlRef,
}: {
  item: MediaItem | undefined;
  controller: MediaPlayer | undefined;
  snapshot: PlayerSnapshot;
  starting: boolean;
  /** A channel coming back by itself after its stream stopped. */
  recovering: boolean;
  /** Where Back finds the layers open now, and closes one. */
  controlRef: RefObject<LayerControl | undefined>;
  /** Where the file is divided, for the scrubber. */
  chapters?: readonly Chapter[];
  /** What is worth offering to skip, as the source marked it. */
  segments?: readonly MediaSegment[];
  next?: Episode;
  /** The player the user picked, which the next episode keeps. */
  player?: PluginId;
  /** A channel: its name, and the group it was opened from — for now and next, and the channels around it. */
  live?: { readonly channel: GlobalMediaKey; readonly title: string; readonly group?: string };
}) {
  // A channel on a TV is watched with the controls away: up and down zap, a
  // banner says what is on, and only select brings the controls.
  const tvLive = isTV && live !== undefined;
  const focused = useIsFocused();
  const [visible, setVisible] = useState(!tvLive);
  const [touchedAt, setTouchedAt] = useState(0);
  const [panel, setPanel] = useState<'audio' | 'subtitles' | 'speed' | 'chapters'>();
  // A channel's group, slid in from the left; the controls stay away while it is.
  const [channels, setChannels] = useState(false);
  const [rate, setRate] = useState(1);
  const { data: settings } = useAppSettings();
  const app = settings ?? APP_DEFAULTS;
  const { seekMs, buttons, topButtons, centreJump, showRemaining, holdRate } = app;
  const seekSeconds = Math.round(seekMs / 1000);
  const [scrub, setScrub] = useState<number>();
  const { state, positionMs, durationMs } = snapshot;
  const playing = state === 'playing';
  const waiting = starting || state === 'loading' || state === 'buffering';

  // The banner: up as a channel opens or zaps, gone a few seconds after it plays, back with right.
  const [banner, setBanner] = useState(tvLive);
  const [bannerAt, setBannerAt] = useState(0);
  const showBanner = () => {
    setBanner(true);
    setBannerAt(Date.now());
  };
  useEffect(() => {
    if (!banner || !playing) return;
    const timer = setTimeout(() => setBanner(false), BANNER_MS);
    return () => clearTimeout(timer);
  }, [banner, playing, bannerAt]);

  // The channels either side, and where a run of up and down presses points:
  // the tune follows once they stop, so a quick run is one new stream, not one per press.
  const lineup = useLineupAround(live?.channel, live?.group, isFavorites(live?.group));
  const [aim, setAim] = useState<Channel>();
  const aimTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(aimTimer.current), []);
  const zap = (offset: -1 | 1) => {
    if (!live) return;
    const target = zapTarget(lineup.list, aim?.key.externalId ?? live.channel.externalId, offset, lineup.more);
    if (target.kind === 'more') return lineup.loadMore();
    if (target.kind !== 'channel') return;
    setAim(target.channel);
    if (tvLive) showBanner();
    clearTimeout(aimTimer.current);
    aimTimer.current = setTimeout(() => router.replace(liveHref(target.channel.key, target.channel.name, live.group)), ZAP_SETTLE_MS);
  };
  const playingChannel = live ? (lineup.found ? lineup.list[lineup.at] : { key: live.channel, name: live.title, groupIds: [] }) : undefined;

  // On a TV's channel, what is over the picture is the overlay's to say; elsewhere the controls
  // are out of the way while it plays, back at a touch, and whenever it stops.
  const overlayState: LiveOverlayState = { state, starting, controls: visible, banner: banner || aim !== undefined, recovering, channels };
  const overlay = tvLive ? liveOverlay(overlayState) : undefined;
  const shown = overlay ? overlay === 'controls' : (visible || !playing) && !channels;

  // What Back finds open, and closes one at a time: a layer counts only where hiding it shows something else.
  const channelPanelRef = useRef<{ close(): void }>(undefined);
  useLayoutEffect(() => {
    controlRef.current = {
      layers: {
        channels,
        panel: panel !== undefined,
        controls: overlay ? overlay === 'controls' && liveOverlay({ ...overlayState, controls: false }) !== 'controls' : shown && playing,
        banner: overlay === 'banner' && liveOverlay({ ...overlayState, banner: false }) !== 'banner',
      },
      close: (step) => {
        if (step === 'channels') channelPanelRef.current?.close();
        else if (step === 'panel') setPanel(undefined);
        else if (step === 'controls') setVisible(false);
        else {
          setBanner(false);
          clearTimeout(aimTimer.current);
          setAim(undefined);
        }
      },
    };
  });
  useEffect(
    () => () => {
      controlRef.current = undefined;
    },
    [controlRef],
  );

  useEffect(() => {
    if (!shown || !playing || panel || scrub !== undefined) return;
    const timer = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [shown, playing, panel, scrub, touchedAt]);

  const touch = () => {
    setVisible(true);
    setTouchedAt(Date.now());
  };
  const toggle = () => {
    touch();
    if (playing) controller?.pause();
    else controller?.play();
  };
  const openChannels = () => {
    setPanel(undefined);
    setVisible(false);
    setChannels(true);
  };
  const closeChannels = () => {
    setChannels(false);
    setVisible(false);
  };
  // Where the last jump went, and when: a quick run of them builds on that,
  // not on a position the engine has not caught up with yet.
  const lastJump = useRef<{ readonly to: number; readonly at: number }>(undefined);
  /**
   * Back or forward, by whatever the setting says that means. `quiet` leaves
   * the controls where they were — away, for a remote's double press, so the
   * next one jumps again rather than moving the focus.
   */
  const jump = (how: PlayerJump, direction: -1 | 1, quiet = false) => {
    if (how === 'off') return;
    const now = Date.now();
    const from = lastJump.current && now - lastJump.current.at < 1_500 ? lastJump.current.to : positionMs;
    const to =
      how === 'seek'
        ? Math.max(0, Math.min(durationMs ?? Number.MAX_SAFE_INTEGER, from + direction * seekMs))
        : chapterBeside(chapters, from, direction);
    if (to === undefined) return;
    lastJump.current = { to, at: now };
    if (!quiet) touch();
    controller?.seek(to);
  };
  const playNext = () => {
    if (!next) return;
    router.replace(playHref(next.key, player ? { player } : {}));
  };

  // What a drag down an edge is showing, while it is showing it.
  const [adjust, setAdjust] = useState<{ readonly kind: Level; readonly value: number }>();
  const [boosted, setBoosted] = useState(false);
  const { brightness, volume } = useServices();
  const [levels, setLevels] = useState({ brightness: 0.5, volume: 1 });
  // Whether the device answered with a volume of its own; until it does, the edge moves the engine's.
  const [deviceVolume, setDeviceVolume] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const lastTap = useRef({ at: 0, x: 0 });
  const insets = useSafeAreaInsets();
  // The level a finished drag leaves showing for a moment; a new drag cancels it.
  const fading = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(fading.current), []);

  // The screen's own brightness and the device's volume are read once, and
  // the brightness put back when the player goes. Only a phone or a tablet
  // has edges to show them on.
  useEffect(() => {
    if (!isHandheld) return;
    let left = false;
    void brightness.get().then((value) => {
      if (left || value === undefined) return;
      setLevels((now) => ({ ...now, brightness: value }));
    });
    void volume.attach();
    void volume.get().then((value) => {
      if (left || value === undefined) return;
      setDeviceVolume(true);
      setLevels((now) => ({ ...now, volume: value }));
    });
    // The side buttons move the same volume. The slider follows them, and the
    // controls come up to show where it went — the system's own banner stays
    // away on an iPhone while the player is open.
    const stop = volume.subscribe((value) => {
      setLevels((now) => ({ ...now, volume: value }));
      setVisible(true);
      setTouchedAt(Date.now());
    });
    return () => {
      left = true;
      stop();
      void brightness.restore();
      void volume.release();
    };
  }, [brightness, volume]);

  // Only a deliberate vertical drag down an outer third takes over; a tap
  // falls through to the controls underneath, which is what makes both
  // possible on the same piece of picture. Not while a panel or a channel's
  // group is open over the picture: a drag there is theirs.
  const edgeScreen: EdgeScreen = {
    claims: (x) => panel === undefined && !channels && size.width > 0 && (x < size.width / 3 || x > (size.width * 2) / 3),
    // The sliders show with the controls only, so a drag brings them up. It
    // starts from where the last one left the level, however recently.
    begin: (x) => {
      touch();
      const kind = x < size.width / 2 ? app.leftSlider : app.rightSlider;
      if (kind === 'off') return undefined;
      clearTimeout(fading.current);
      const from = adjust?.kind === kind ? adjust.value : levels[kind];
      setAdjust({ kind, value: from });
      return { kind, from, height: size.height || 1 };
    },
    move: ({ kind }, value) => {
      setAdjust({ kind, value });
      if (kind === 'brightness') void brightness.set(value);
      // The device's volume where it has one; until then, the engine's.
      else if (deviceVolume) void volume.set(value);
      else controller?.setVolume?.(value);
    },
    // Where it ended is where the next one starts. Taken by something else
    // mid-drag, where it got to still stands.
    end: ({ kind }, value, released) => {
      setLevels((now) => ({ ...now, [kind]: value }));
      if (!released) {
        setAdjust(undefined);
        return;
      }
      touch();
      fading.current = setTimeout(() => setAdjust(undefined), 600);
    },
  };
  const [edges] = useState(edgeResponder);
  useLayoutEffect(() => {
    edges.follow(edgeScreen);
  });

  // The side a double tap jumped from lights up, faintly, and fades: the
  // picture answers the finger without covering the film.
  const [flash] = useState(() => ({ left: new Animated.Value(0), right: new Animated.Value(0) }));
  const flashSide = (side: 'left' | 'right') => {
    const value = flash[side];
    value.stopAnimation();
    value.setValue(1);
    Animated.timing(value, { toValue: 0, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  };

  /** A tap, unless another followed it quickly on the same side — then a jump. */
  const onTap = (x: number) => {
    const now = Date.now();
    const sameSide = x < size.width / 2 === lastTap.current.x < size.width / 2;
    if (app.doubleTap !== 'off' && !live && now - lastTap.current.at < 300 && sameSide) {
      lastTap.current = { at: 0, x };
      flashSide(x < size.width / 2 ? 'left' : 'right');
      jump(app.doubleTap, x < size.width / 2 ? -1 : 1);
      return;
    }
    lastTap.current = { at: now, x };
    if (shown) setVisible(false);
    else touch();
  };

  // A remote's left or right waiting to learn whether a second press follows.
  const pending = useRef<{ readonly key: 'left' | 'right'; readonly timer: ReturnType<typeof setTimeout> }>(undefined);
  useEffect(() => () => clearTimeout(pending.current?.timer), []);

  /**
   * Left or right with the controls away, as a tap on that side would be: a
   * second press inside the window jumps, flashing the side, and leaves them
   * away; a lone one brings them up once the window has passed.
   */
  const arrow = (key: 'left' | 'right') => {
    const first = pending.current;
    clearTimeout(first?.timer);
    pending.current = undefined;
    if (first?.key === key) {
      flashSide(key);
      jump(app.doubleTap, key === 'left' ? -1 : 1, true);
      return;
    }
    if (app.doubleTap === 'off') return touch();
    pending.current = {
      key,
      timer: setTimeout(() => {
        pending.current = undefined;
        touch();
      }, DOUBLE_PRESS_MS),
    };
  };

  // A TV remote. Play/pause plays and pauses. With the controls up, the
  // arrows move the focus among them, and keep them up while they do; select
  // is the focused control's own. With them away, select brings them back —
  // focus on play. On a channel, up and down zap, left opens its group, right
  // brings the banner; elsewhere up and down bring the controls too, and left
  // and right are the picture's sides. While the group is open, the arrows are
  // its own. Every screen hears the remote, so only the one in front acts: a
  // zap leaves the player before for a moment.
  useRemoteKeys((key) => {
    if (!focused) return;
    if (key === 'playPause') return toggle();
    if (channels) return;
    if (shown) {
      if (key !== 'select') touch();
      return;
    }
    if (tvLive) {
      if (key === 'up' || key === 'down') return zap(key === 'up' ? -1 : 1);
      if (key === 'left') return openChannels();
      if (key === 'right') return showBanner();
      return touch();
    }
    if (key === 'select' || key === 'up' || key === 'down') return touch();
    if (live) return key === 'left' ? openChannels() : touch();
    arrow(key);
  });

  const hold = (on: boolean) => {
    if (holdRate <= 1 || live || !controller?.setRate) return;
    setBoosted(on);
    controller.setRate(on ? holdRate : 1);
  };

  /** One row of buttons, from whichever list was arranged for it. */
  const row = (which: readonly PlayerButton[]) =>
    which.map((button: PlayerButton) => {
                // A button with nothing behind it is not shown: no second audio
                // track, no subtitles, an engine that cannot change its rate.
                const open = (which: typeof panel) => () => setPanel(panel === which ? undefined : which);
                if (button === 'audio') {
                  return snapshot.audio.length > 1 ? (
                    <IconButton key={button} label="Audio" onPress={open('audio')}>
                      <AudioLines size={24} color="white" />
                    </IconButton>
                  ) : null;
                }
                if (button === 'subtitles') {
                  return snapshot.subtitles.length > 0 ? (
                    <IconButton key={button} label="Subtitles" onPress={open('subtitles')}>
                      <Captions size={24} color="white" />
                    </IconButton>
                  ) : null;
                }
                if (button === 'speed') {
                  return controller?.setRate && !live ? (
                    <IconButton key={button} label="Speed" onPress={open('speed')}>
                      <Gauge size={24} color="white" />
                    </IconButton>
                  ) : null;
                }
                if (button === 'chapters') {
                  return (chapters?.length ?? 0) > 1 && !live ? (
                    <IconButton key={button} label="Chapters" onPress={open('chapters')}>
                      <List size={24} color="white" />
                    </IconButton>
                  ) : null;
                }
                return next ? (
                  <IconButton key={button} label="Next episode" onPress={playNext}>
                    <SkipForward size={24} color="white" />
                  </IconButton>
                ) : null;
    });

  // What the source marked this moment as, and what to offer for it. An outro
  // is where the next episode belongs — so there is no button for it the rest
  // of the time.
  const here = live ? undefined : segmentAt(segments, scrub ?? positionMs);
  const skipAction =
    here === undefined
      ? undefined
      : here.kind === 'outro'
        ? next
          ? { label: 'Next episode', run: playNext }
          : undefined
        : { label: SKIP_LABELS[here.kind], run: () => {
            touch();
            controller?.seek(here.endMs);
          } };

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
      {...(isHandheld ? edges.responder.panHandlers : {})}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={(event) => onTap(event.nativeEvent.locationX)}
        onLongPress={() => hold(true)}
        onPressOut={() => hold(false)}
        delayLongPress={400}
        accessibilityLabel={shown ? 'Hide the controls' : 'Show the controls'}
        // On a TV it wraps every control: holding the focus, it would never hand it on to them.
        {...(isTV ? { focusable: false } : {})}
      >
      {shown ? (
        <YStack
          flex={1}
          justify="space-between"
          bg="rgba(0, 0, 0, 0.45)"
          // Clear of a notch, a rounded corner or a television's overscan, on whichever side the phone turned it.
          pl={insets.left + px(18)}
          pr={insets.right + px(18)}
          pt={insets.top + px(24)}
          pb={insets.bottom + px(24)}
        >
          {/* Each row is one group to a remote: up and down land in it from anywhere above or below, on the control last used there. */}
          <FocusGroup>
            <XStack items="center" gap="$3">
              <IconButton label="Close the player" onPress={close}>
                <X size={26} color="white" />
              </IconButton>
              <YStack flex={1}>
                {live ? <LiveBar channel={live.channel} title={live.title} lineup={lineup} onZap={zap} onChannels={openChannels} /> : null}
                {item?.type === 'episode' ? (
                  <SizableText size="$2" color="rgba(255,255,255,0.75)" numberOfLines={1}>
                    {[item.showTitle, episodeCode(item)].filter(Boolean).join(' · ')}
                  </SizableText>
                ) : null}
                <SizableText size="$5" fontWeight="600" color="white" numberOfLines={1}>
                  {item?.title ?? ''}
                </SizableText>
              </YStack>
              {/* The top left is always what is playing; what floats at the right is arranged. */}
              <XStack items="center" gap="$2">{row(topButtons)}</XStack>
            </XStack>
          </FocusGroup>

          <FocusGroup>
            <XStack items="center" justify="center" gap="$8">
              {live || centreJump === 'off' ? null : (
                <IconButton
                  label={centreJump === 'chapter' ? 'Chapter back' : `Back ${seekSeconds} seconds`}
                  onPress={() => jump(centreJump, -1)}
                  disabled={!controller}
                >
                  {centreJump === 'chapter' ? <ChevronsLeft size={30} color="white" /> : <RotateCcw size={30} color="white" />}
                </IconButton>
              )}
              {/* Always there while the controls are, spinning while it loads: the focus starts here each time they come up, and a remote's focus must have somewhere to land. */}
              <IconButton label={waiting ? 'Loading' : playing ? 'Pause' : 'Play'} onPress={toggle} big preferred>
                {waiting ? (
                  <Spinner size="large" color="white" />
                ) : playing ? (
                  <Pause size={44} color="white" fill="white" />
                ) : (
                  <Play size={44} color="white" fill="white" />
                )}
              </IconButton>
              {live || centreJump === 'off' ? null : (
                <IconButton
                  label={centreJump === 'chapter' ? 'Chapter forward' : `Forward ${seekSeconds} seconds`}
                  onPress={() => jump(centreJump, 1)}
                  disabled={!controller}
                >
                  {centreJump === 'chapter' ? <ChevronsRight size={30} color="white" /> : <RotateCw size={30} color="white" />}
                </IconButton>
              )}
            </XStack>
          </FocusGroup>

          <YStack gap="$3">
            {panel === 'audio' || panel === 'subtitles' ? (
              <TrackPanel
                kind={panel}
                tracks={panel === 'audio' ? snapshot.audio : snapshot.subtitles}
                onChoose={(id) => {
                  if (panel === 'audio' && id !== null) controller?.setAudioTrack(id);
                  if (panel === 'subtitles') controller?.setSubtitleTrack(id);
                  setPanel(undefined);
                  touch();
                }}
              />
            ) : null}
            {panel === 'speed' ? (
              <Panel>
                {RATES.map((each) => (
                  <PanelRow
                    key={each}
                    label={each === 1 ? 'Normal' : `${each}×`}
                    chosen={each === rate}
                    onPress={() => {
                      controller?.setRate?.(each);
                      setRate(each);
                      setPanel(undefined);
                      touch();
                    }}
                  />
                ))}
              </Panel>
            ) : null}
            {panel === 'chapters' ? (
              <Panel>
                {(chapters ?? []).map((chapter, index) => (
                  <PanelRow
                    key={chapter.startMs}
                    label={`${chapter.title ?? `Chapter ${index + 1}`} · ${clockTime(chapter.startMs)}`}
                    chosen={segmentOfChapter(chapters, positionMs) === index}
                    onPress={() => {
                      controller?.seek(chapter.startMs);
                      setPanel(undefined);
                      touch();
                    }}
                  />
                ))}
              </Panel>
            ) : null}
            {/* A channel is never scrubbed, even when its stream reports a length. */}
            {durationMs && !live ? (
              <XStack items="center" gap="$3">
                <SizableText size="$2" color="white" minW={px(52)}>
                  {clockTime(scrub ?? positionMs)}
                </SizableText>
                {isTV ? (
                  // A remote cannot drag a thumb: a double press of left or right jumps, and this only says where it is.
                  <YStack flex={1} height={6} rounded={3} bg="rgba(255,255,255,0.3)" overflow="hidden">
                    <YStack height="100%" width={`${Math.min(100, ((scrub ?? positionMs) / durationMs) * 100)}%`} bg="$accent9" />
                  </YStack>
                ) : (
                  <Slider
                    flex={1}
                    size="$2"
                    max={durationMs}
                    step={1_000}
                    value={[Math.min(durationMs, scrub ?? positionMs)]}
                    onValueChange={(value) => setScrub(value[0])}
                    onSlideEnd={(_event, value) => {
                      controller?.seek(value);
                      setScrub(undefined);
                      touch();
                    }}
                    aria-label="Position"
                  >
                    <Slider.Track bg="rgba(255,255,255,0.3)">
                      <Slider.TrackActive bg="$accent9" />
                      {/* Where each chapter begins, so the length of one can be seen. The first is the start of the file, which needs no mark. */}
                      {(chapters ?? []).map((chapter) =>
                        chapter.startMs <= 0 || chapter.startMs >= durationMs ? null : (
                          <YStack
                            key={chapter.startMs}
                            position="absolute"
                            l={`${(chapter.startMs / durationMs) * 100}%`}
                            t={0}
                            b={0}
                            width={2}
                            bg="rgba(0,0,0,0.55)"
                            pointerEvents="none"
                          />
                        ),
                      )}
                    </Slider.Track>
                    <Slider.Thumb index={0} circular size="$1" bg="white" />
                  </Slider>
                )}
                <SizableText size="$2" color="white" minW={px(52)} text="right">
                  {showRemaining ? `-${clockTime(Math.max(0, durationMs - (scrub ?? positionMs)))}` : clockTime(durationMs)}
                </SizableText>
              </XStack>
            ) : null}
            <FocusGroup>
              <XStack items="center" gap="$2">
                <XStack flex={1}>{skipAction ? <SkipButton label={skipAction.label} onPress={skipAction.run} /> : null}</XStack>
                {row(buttons)}
              </XStack>
            </FocusGroup>
          </YStack>
        </YStack>
      ) : null}
      </Pressable>
      {/* On a TV, where the focus rests while the controls are away: when the focused control goes with them, this is all that is left to take it. Select presses it, and they come back. */}
      {isTV && !shown && !channels ? <Pressable style={StyleSheet.absoluteFill} onPress={touch} accessibilityLabel="Show the controls" /> : null}
      {(['left', 'right'] as const).map((side) => (
        <Animated.View
          key={`flash-${side}`}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: '50%',
            ...(side === 'left' ? { left: 0 } : { right: 0 }),
            backgroundColor: `rgba(255, 255, 255, ${FLASH_ALPHA})`,
            opacity: flash[side],
            pointerEvents: 'none',
          }}
        />
      ))}
      {shown && isHandheld
        ? (['left', 'right'] as const).map((side) => {
            const kind = side === 'left' ? app.leftSlider : app.rightSlider;
            if (kind === 'off') return null;
            return (
              <EdgeSlider
                key={side}
                side={side}
                inset={(side === 'left' ? insets.left : insets.right) + px(24)}
                kind={kind}
                value={adjust?.kind === kind ? adjust.value : levels[kind]}
                active={adjust?.kind === kind}
              />
            );
          })
        : null}
      {boosted ? (
        <YStack position="absolute" t={insets.top + px(46)} l={0} r={0} items="center" pointerEvents="none">
          <SizableText size="$5" fontWeight="700" color="white" bg="rgba(0,0,0,0.6)" px="$3" py="$2" rounded="$10">
            {holdRate}× ▸▸
          </SizableText>
        </YStack>
      ) : null}
      {overlay === 'banner' && playingChannel ? <ChannelBanner channel={aim ?? playingChannel} waiting={waiting || recovering || aim !== undefined} reconnecting={recovering} /> : null}
      {channels && live ? <ChannelPanel channel={live.channel} group={live.group} onClose={closeChannels} controlRef={channelPanelRef} /> : null}
    </View>
  );
}

type Level = Exclude<PlayerSlider, 'off'>;

/** One drag down an edge: what it moves, where that stood when the finger went down, and the height a whole sweep spans. */
interface EdgeDrag {
  readonly kind: Level;
  readonly from: number;
  readonly height: number;
}

/** What a drag down an edge asks of the screen, as the screen stands at its latest render. */
interface EdgeScreen {
  claims(x: number): boolean;
  begin(x: number): EdgeDrag | undefined;
  move(drag: EdgeDrag, value: number): void;
  end(drag: EdgeDrag, value: number, released: boolean): void;
}

/**
 * One responder for the player's whole life, keeping its drag to itself; the
 * screen hands it its latest state after every render (`follow`). Made afresh
 * on every render — and the grant itself renders — a drag's moves reached a
 * responder that had never granted it: where it began read as 0, so always
 * the left edge, and how far it had come as only its last step.
 */
function edgeResponder(): { readonly responder: PanResponderInstance; readonly follow: (screen: EdgeScreen) => void } {
  let screen: EdgeScreen | undefined;
  let drag: EdgeDrag | undefined;
  let value = 0;
  const finish = (released: boolean) => {
    if (drag) screen?.end(drag, value, released);
    drag = undefined;
  };
  const responder = PanResponder.create({
    // Where a drag began is set only once it is granted; before that, it is
    // where the finger is, less how far it has come.
    onMoveShouldSetPanResponder: (_event, state) =>
      Math.abs(state.dy) >= 12 && Math.abs(state.dy) >= Math.abs(state.dx) && (screen?.claims(state.moveX - state.dx) ?? false),
    onPanResponderGrant: (_event, state) => {
      drag = screen?.begin(state.x0);
      value = drag?.from ?? 0;
    },
    // Measured from where the level stood when the finger went down, so a
    // change it hears back — the device telling it the volume it just set —
    // cannot move where the drag started. Up is more, as every phone does it.
    onPanResponderMove: (_event, state) => {
      if (!drag) return;
      value = Math.min(1, Math.max(0, drag.from - state.dy / drag.height / 2));
      screen?.move(drag, value);
    },
    onPanResponderRelease: () => finish(true),
    onPanResponderTerminate: () => finish(false),
  });
  return {
    responder,
    follow: (next) => {
      screen = next;
    },
  };
}

/**
 * A level down one edge of the picture, shown with the controls: where it
 * stands, and while a drag moves it, the number. It draws only — the drag is
 * the whole picture's, so a finger anywhere along the edge moves it.
 */
function EdgeSlider({ side, inset, kind, value, active }: { side: 'left' | 'right'; inset: number; kind: Level; value: number; active: boolean }) {
  const level = Math.round(value * 100);
  const icon = kind === 'brightness' ? <Sun size={20} color="white" /> : level === 0 ? <VolumeX size={20} color="white" /> : <Volume2 size={20} color="white" />;
  return (
    <YStack
      position="absolute"
      t="28%"
      b="28%"
      {...(side === 'left' ? { l: inset } : { r: inset })}
      items="center"
      gap="$2"
      pointerEvents="none"
      accessibilityLabel={`${kind === 'brightness' ? 'Brightness' : 'Volume'}, ${level}%`}
    >
      {icon}
      <YStack flex={1} width={px(6)} rounded="$10" bg="rgba(255, 255, 255, 0.3)" overflow="hidden" justify="flex-end">
        <YStack height={`${level}%`} bg="white" />
      </YStack>
      <SizableText size="$2" fontWeight="600" color="white" opacity={active ? 1 : 0}>
        {level}%
      </SizableText>
    </YStack>
  );
}

/**
 * A channel's name marked live, what is on now and next, and the channels
 * either side in its group — or among the favourites, when it was opened
 * from the ★ list — with the whole group a press away.
 */
function LiveBar({
  channel,
  title,
  lineup,
  onZap,
  onChannels,
}: {
  channel: GlobalMediaKey;
  title: string;
  lineup: { readonly list: readonly Channel[]; readonly at: number; readonly more: boolean };
  onZap: (offset: -1 | 1) => void;
  onChannels: () => void;
}) {
  const { list, at, more } = lineup;
  const guide = useGuide(channel.connectionId, [channel]);
  const now = useNow();
  const { now: airing, next } = nowAndNext(guide.data?.value, channel, now);
  return (
    <XStack items="center" gap="$3">
      <YStack flex={1} gap="$1">
        <XStack items="center" gap="$2">
          <SizableText size="$1" fontWeight="800" color="white" bg="$red10" px="$1.5" rounded="$2">
            LIVE
          </SizableText>
          <SizableText size="$5" fontWeight="600" color="white" numberOfLines={1}>
            {title}
          </SizableText>
        </XStack>
        {airing ? (
          <SizableText size="$2" color="rgba(255,255,255,0.8)" numberOfLines={1}>
            {`Now: ${airing.title}`}
          </SizableText>
        ) : null}
        {next ? (
          <SizableText size="$2" color="rgba(255,255,255,0.6)" numberOfLines={1}>
            {`Next: ${next.title}`}
          </SizableText>
        ) : null}
      </YStack>
      <XStack gap="$2">
        {list.length > 1 && at >= 0 ? (
          <>
            <IconButton label="Previous channel" onPress={() => onZap(-1)}>
              <ChevronUp size={28} color="white" />
            </IconButton>
            <IconButton label="Next channel" onPress={() => onZap(1)}>
              <ChevronDown size={28} color="white" />
            </IconButton>
          </>
        ) : null}
        {list.length > 1 || more ? (
          <IconButton label="Channels" onPress={onChannels}>
            <List size={26} color="white" />
          </IconButton>
        ) : null}
      </XStack>
    </XStack>
  );
}

function TrackPanel({
  kind,
  tracks,
  onChoose,
}: {
  kind: 'audio' | 'subtitles';
  tracks: readonly (AudioTrack | SubtitleTrack)[];
  onChoose: (id: string | null) => void;
}) {
  // Which track plays is the engine's to know, and it does not say: the focus starts on the first.
  return (
    <Panel>
      {kind === 'subtitles' ? <PanelRow label="Off" chosen={false} preferred onPress={() => onChoose(null)} /> : null}
      {tracks.map((track, index) => (
        <PanelRow key={track.id} label={track.label} chosen={false} preferred={kind === 'audio' && index === 0} onPress={() => onChoose(track.id)} />
      ))}
    </Panel>
  );
}

function IconButton({
  label,
  onPress,
  disabled,
  big,
  preferred = false,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  big?: boolean;
  /** Where a remote's focus goes as it appears. */
  preferred?: boolean;
  children: ReactNode;
}) {
  const { focused, handlers } = useRemoteFocus();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      style={{ opacity: disabled ? 0.4 : 1 }}
      {...(isTV ? { hasTVPreferredFocus: preferred, ...handlers } : {})}
    >
      <YStack p={px(big ? 12 : 6)} rounded={999} bg={focused ? 'rgba(255, 255, 255, 0.16)' : 'transparent'} {...(focused ? FOCUSED : {})}>
        {children}
      </YStack>
    </Pressable>
  );
}

function Notice({ message, onRetry, players }: { message: string; onRetry?: () => void; players?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <YStack flex={1} items="center" justify="center" gap="$4" px="$6">
      <XStack position="absolute" t={insets.top + px(24)} l={insets.left + px(18)}>
        <IconButton label="Close the player" onPress={close}>
          <X size={26} color="white" />
        </IconButton>
      </XStack>
      <SizableText size="$5" color="white" text="center" maxW={px(520)}>
        {message}
      </SizableText>
      {onRetry ? <PrimaryButton onPress={onRetry}>Try again</PrimaryButton> : null}
      {players ? (
        <PrimaryButton onPress={() => router.push(categoryHref('players'))}>
          Players on this device
        </PrimaryButton>
      ) : null}
    </YStack>
  );
}

/** What each skippable stretch is called, where it is offered as a skip forward. */
const SKIP_LABELS: Readonly<Record<Exclude<MediaSegment['kind'], 'outro'>, string>> = {
  intro: 'Skip intro',
  recap: 'Skip recap',
  preview: 'Skip preview',
  commercial: 'Skip advert',
};

/** The one button that comes and goes with the film: shown only inside the stretch it skips. */
function SkipButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Button size="$3" bg="rgba(255,255,255,0.15)" borderColor="rgba(255,255,255,0.4)" borderWidth={1} onPress={onPress} aria-label={label}>
      <Button.Text color="white" fontWeight="600">
        {label}
      </Button.Text>
    </Button>
  );
}

/** Which chapter a position is in, for marking the one playing. */
function segmentOfChapter(chapters: readonly Chapter[] | undefined, positionMs: number): number {
  let at = -1;
  (chapters ?? []).forEach((chapter, index) => {
    if (chapter.startMs <= positionMs) at = index;
  });
  return at;
}

/**
 * The sheet a button opens over the controls: speed, chapters, tracks. It
 * scrolls, and on a TV keeps the focus in until it leaves downwards, back to
 * the row of buttons that opened it.
 */
function Panel({ children }: { children: ReactNode }) {
  return (
    <YStack self="flex-end" bg="rgba(20, 20, 20, 0.92)" rounded="$4" p="$2" minW={px(220)} maxW={px(360)} maxH={px(260)} overflow="hidden">
      <FocusGroup trap>
        <ScrollView>{children}</ScrollView>
      </FocusGroup>
    </YStack>
  );
}

function PanelRow({ label, chosen, preferred = chosen, onPress }: { label: string; chosen: boolean; preferred?: boolean; onPress: () => void }) {
  const { focused, handlers } = useRemoteFocus();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: chosen }}
      {...(isTV ? { hasTVPreferredFocus: preferred, ...handlers } : {})}
    >
      <YStack px="$3" py="$2" rounded="$3" bg={focused ? '$accent4' : 'transparent'}>
        <SizableText size="$4" color={focused ? '$accent11' : chosen ? '$accent9' : 'white'} fontWeight={chosen ? '700' : '400'} numberOfLines={1}>
          {label}
        </SizableText>
      </YStack>
    </Pressable>
  );
}

/** The chapter before or after a position, or nothing at either end. */
function chapterBeside(chapters: readonly Chapter[] | undefined, positionMs: number, direction: -1 | 1): number | undefined {
  const starts = (chapters ?? []).map((chapter) => chapter.startMs);
  if (starts.length === 0) return undefined;
  if (direction === 1) return starts.find((start) => start > positionMs + 1_000);
  // Back goes to the top of this chapter first, as a disc player does, and
  // only to the one before when it is already there.
  const here = starts.filter((start) => start <= positionMs - 3_000).at(-1);
  return here ?? 0;
}

/**
 * Picture in picture and background sound, asked of the engine once there is
 * one. Both are the device's settings, and an engine without either simply
 * carries on as before. A channel is neither: it is live, and shrinking it
 * into a corner to keep the sound is not what anyone means by it.
 *
 * Picture in picture is armed only while something plays. The system starts
 * it by itself as the app is left, so a film paused, finished or closed must
 * not be armed by then — or leaving shrinks a still or empty picture.
 */
function usePlayerLeaving(controller: MediaPlayer | undefined, live: boolean, playing: boolean) {
  const { data } = useAppSettings();
  const { pictureInPicture: platform } = useServices();
  const armed = (data ?? APP_DEFAULTS).pictureInPicture && !live && playing;
  const backgroundPlayback = (data ?? APP_DEFAULTS).backgroundPlayback;
  const [shrunk, setShrunk] = useState(false);

  useEffect(() => {
    if (!controller) return;
    controller.setBackgroundPlayback?.(backgroundPlayback);
  }, [controller, backgroundPlayback]);

  useEffect(() => {
    if (!controller) return;
    // Two ways in, and a platform may have both. On Android the activity
    // shrinks, so it is asked for whatever is playing; on iPhone only an
    // engine that draws into a layer the system can take has anything to give.
    controller.setPictureInPicture?.(armed);
    platform.setAutoEnter(armed);
    return () => {
      platform.setAutoEnter(false);
      try {
        controller.setPictureInPicture?.(false);
      } catch {
        // Already released, with the screen: it shrinks nothing any more.
      }
    };
  }, [controller, armed, platform]);

  // In that window there is room for the picture and nothing else.
  useEffect(() => platform.subscribe(setShrunk), [platform]);

  return shrunk;
}
