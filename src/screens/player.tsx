import { segmentAt, type AudioTrack, type Chapter, type ConnectionId, type Episode, type GlobalMediaKey, type MediaItem, type MediaPlayer, type MediaSegment, type PluginId, type SubtitleTrack } from '@sc/api';
import type { PlayerView } from '@sc/player-kit';
import { AudioLines } from '@tamagui/lucide-icons-2/icons/AudioLines';
import { Captions } from '@tamagui/lucide-icons-2/icons/Captions';
import { ChevronsLeft } from '@tamagui/lucide-icons-2/icons/ChevronsLeft';
import { ChevronsRight } from '@tamagui/lucide-icons-2/icons/ChevronsRight';
import { Sun } from '@tamagui/lucide-icons-2/icons/Sun';
import { Volume2 } from '@tamagui/lucide-icons-2/icons/Volume2';
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
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, StyleSheet, View, type GestureResponderEvent, type PanResponderGestureState } from 'react-native';
import { Button, SizableText, Slider, Spinner, XStack, YStack } from 'tamagui';

import { clockTime, describeMissing, episodeCode } from '@/components/labels';
import { liveHref, playHref } from '@/components/media/item-link';
import { PrimaryButton } from '@/components/primary-button';
import { useAppSettings } from '@/hooks/use-app-settings';
import { nowAndNext, useChannels, useGuide, useNow } from '@/hooks/use-live';
import { useItem } from '@/hooks/use-media';
import { useNextEpisode, usePlaybackPlan, usePlaybackReports, usePlayer, usePlayerOrientation, type PlayerSnapshot } from '@/hooks/use-playback';
import { APP_DEFAULTS } from '@/services/app-settings';
import type { PlayerButton, PlayerJump, PlayerSlider } from '@/services/ports';
import { useServices } from '@/hooks/services-context';
import { categoryHref } from '@/screens/settings/plugin-route';

const HIDE_AFTER_MS = 3_500;
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
  const shrunk = usePlayerLeaving(controller, live !== undefined);
  const { playback } = useServices();
  const View = plan?.kind === 'play' ? playback.view(plan.player) : undefined;
  const next = useNextEpisode(item?.type === 'episode' ? item : undefined);

  const problem = !live && detail.error
    ? detail.error.message
    : planError
      ? `This could not be started: ${planError.message}`
      : plan?.kind === 'none'
        ? describeMissing(plan.needs, plan.source)
        : plan?.kind === 'no-player'
          ? 'Every player is switched off on this device.'
          : snapshot.state === 'failed'
            ? (snapshot.error?.message ?? 'This stopped playing.')
            : undefined;

  return (
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
          {...(live ? { live: <LiveBar channel={key} title={live.title} {...(live.group ? { group: live.group } : {})} /> } : {})}
        />
      )}
    </YStack>
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
}: {
  item: MediaItem | undefined;
  controller: MediaPlayer | undefined;
  snapshot: PlayerSnapshot;
  starting: boolean;
  /** Where the file is divided, for the scrubber. */
  chapters?: readonly Chapter[];
  /** What is worth offering to skip, as the source marked it. */
  segments?: readonly MediaSegment[];
  next?: Episode;
  /** The player the user picked, which the next episode keeps. */
  player?: PluginId;
  /** For a channel: its name, now and next, and the channels either side. */
  live?: ReactNode;
}) {
  const [visible, setVisible] = useState(true);
  const [touchedAt, setTouchedAt] = useState(0);
  const [panel, setPanel] = useState<'audio' | 'subtitles' | 'speed' | 'chapters'>();
  const [rate, setRate] = useState(1);
  const { data: settings } = useAppSettings();
  const app = settings ?? APP_DEFAULTS;
  const { seekMs, buttons, topButtons, centreJump, showRemaining, holdRate } = app;
  const seekSeconds = Math.round(seekMs / 1000);
  const [scrub, setScrub] = useState<number>();
  const { state, positionMs, durationMs } = snapshot;
  const playing = state === 'playing';
  const waiting = starting || state === 'loading' || state === 'buffering';
  // Out of the way while it plays; back at a touch, and whenever it stops.
  const shown = visible || !playing;

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
  const skip = (by: number) => {
    touch();
    controller?.seek(Math.max(0, Math.min(durationMs ?? Number.MAX_SAFE_INTEGER, positionMs + by)));
  };
  /** Back or forward, by whatever the setting says that means. */
  const jump = (how: PlayerJump, direction: -1 | 1) => {
    if (how === 'off') return;
    if (how === 'seek') return skip(direction * seekMs);
    const to = chapterBeside(chapters, positionMs, direction);
    if (to === undefined) return;
    touch();
    controller?.seek(to);
  };
  const playNext = () => {
    if (!next) return;
    router.replace(playHref(next.key, player ? { player } : {}));
  };

  // What a drag down an edge is showing, while it is showing it.
  const [adjust, setAdjust] = useState<{ readonly kind: PlayerSlider; readonly value: number }>();
  const [boosted, setBoosted] = useState(false);
  const { brightness } = useServices();
  const [levels, setLevels] = useState({ brightness: 0.5, volume: 1 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const lastTap = useRef({ at: 0, x: 0 });

  // The screen's own brightness is read once, and put back when the player goes.
  useEffect(() => {
    let left = false;
    void brightness.get().then((value) => {
      if (!left && value !== undefined) setLevels((now) => ({ ...now, brightness: value }));
    });
    return () => {
      left = true;
      void brightness.restore();
    };
  }, [brightness]);

  /**
   * `by` is how far the whole drag has come, not the step since the last call:
   * taken from where the level stood when the finger went down, a drag cannot
   * drift away from the finger however often it reports.
   */
  const drag = (kind: PlayerSlider, by: number) => {
    if (kind === 'off') return;
    const next = Math.min(1, Math.max(0, levels[kind] + by));
    setAdjust({ kind, value: next });
    if (kind === 'brightness') void brightness.set(next);
    else controller?.setVolume?.(next);
  };

  // Only a deliberate vertical drag down an edge takes over; a tap falls
  // through to the controls underneath, which is what makes both possible on
  // the same piece of picture. `x0` is where the gesture began, so which edge
  // it belongs to needs nothing remembered between its calls.
  const edges = PanResponder.create({
    onMoveShouldSetPanResponder: (_event: GestureResponderEvent, state: PanResponderGestureState) => {
      if (Math.abs(state.dy) < 12 || Math.abs(state.dy) < Math.abs(state.dx)) return false;
      const third = size.width / 3;
      return state.x0 < third || state.x0 > size.width - third;
    },
    onPanResponderMove: (_event: GestureResponderEvent, state: PanResponderGestureState) => {
      // Up is more, as every phone does it.
      drag(state.x0 < size.width / 2 ? app.leftSlider : app.rightSlider, -state.dy / (size.height || 1) / 2);
    },
    // Where it ended is where it starts from next time.
    onPanResponderRelease: (_event: GestureResponderEvent, state: PanResponderGestureState) => {
      const kind = state.x0 < size.width / 2 ? app.leftSlider : app.rightSlider;
      if (kind !== 'off') {
        const next = Math.min(1, Math.max(0, levels[kind] + -state.dy / (size.height || 1) / 2));
        setLevels((now) => ({ ...now, [kind]: next }));
      }
      setTimeout(() => setAdjust(undefined), 600);
    },
  });

  /** A tap, unless another followed it quickly on the same side — then a jump. */
  const onTap = (x: number) => {
    const now = Date.now();
    const sameSide = x < size.width / 2 === lastTap.current.x < size.width / 2;
    if (app.doubleTap !== 'off' && !live && now - lastTap.current.at < 300 && sameSide) {
      lastTap.current = { at: 0, x };
      jump(app.doubleTap, x < size.width / 2 ? -1 : 1);
      return;
    }
    lastTap.current = { at: now, x };
    if (shown) setVisible(false);
    else touch();
  };

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
      {...edges.panHandlers}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={(event) => onTap(event.nativeEvent.locationX)}
        onLongPress={() => hold(true)}
        onPressOut={() => hold(false)}
        delayLongPress={400}
        accessibilityLabel={shown ? 'Hide the controls' : 'Show the controls'}
      >
      {shown ? (
        <YStack flex={1} justify="space-between" bg="rgba(0, 0, 0, 0.45)" px="$4" pt="$5" pb="$5">
          <XStack items="center" gap="$3">
            <IconButton label="Close the player" onPress={close}>
              <X size={26} color="white" />
            </IconButton>
            <YStack flex={1}>
              {live}
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
            {waiting ? (
              <Spinner size="large" color="white" />
            ) : (
              <IconButton label={playing ? 'Pause' : 'Play'} onPress={toggle} big>
                {playing ? <Pause size={44} color="white" fill="white" /> : <Play size={44} color="white" fill="white" />}
              </IconButton>
            )}
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
                <SizableText size="$2" color="white" minW={52}>
                  {clockTime(scrub ?? positionMs)}
                </SizableText>
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
                <SizableText size="$2" color="white" minW={52} text="right">
                  {showRemaining ? `-${clockTime(Math.max(0, durationMs - (scrub ?? positionMs)))}` : clockTime(durationMs)}
                </SizableText>
              </XStack>
            ) : null}
            <XStack items="center" gap="$2">
              <XStack flex={1}>{skipAction ? <SkipButton label={skipAction.label} onPress={skipAction.run} /> : null}</XStack>
              {row(buttons)}
            </XStack>
          </YStack>
        </YStack>
      ) : null}
      </Pressable>
      {adjust && adjust.kind !== 'off' ? <EdgeReadout kind={adjust.kind} value={adjust.value} /> : null}
      {boosted ? (
        <YStack position="absolute" t="$8" l={0} r={0} items="center" pointerEvents="none">
          <SizableText size="$5" fontWeight="700" color="white" bg="rgba(0,0,0,0.6)" px="$3" py="$2" rounded="$10">
            {holdRate}× ▸▸
          </SizableText>
        </YStack>
      ) : null}
    </View>
  );
}

/** What a drag down an edge is doing, while it is doing it. */
function EdgeReadout({ kind, value }: { kind: Exclude<PlayerSlider, 'off'>; value: number }) {
  return (
    <YStack position="absolute" t={0} b={0} l={0} r={0} items="center" justify="center" pointerEvents="none">
      <YStack items="center" gap="$2" bg="rgba(0,0,0,0.6)" px="$4" py="$3" rounded="$6">
        {kind === 'brightness' ? <Sun size={24} color="white" /> : <Volume2 size={24} color="white" />}
        <SizableText size="$4" fontWeight="600" color="white">
          {Math.round(value * 100)}%
        </SizableText>
      </YStack>
    </YStack>
  );
}

/** A channel's name marked live, what is on now and next, and the channels either side in its group. */
function LiveBar({ channel, title, group }: { channel: GlobalMediaKey; title: string; group?: string }) {
  const channels = useChannels(channel.connectionId, group);
  const list = channels.data?.pages.flatMap((page) => page.value.channels) ?? [];
  const at = list.findIndex((each) => each.key.externalId === channel.externalId);
  const guide = useGuide(channel.connectionId, [channel]);
  const now = useNow();
  const { now: airing, next } = nowAndNext(guide.data?.value, channel, now);
  const zap = (offset: number) => {
    const target = at >= 0 ? list[(at + offset + list.length) % list.length] : undefined;
    if (!target || target.key.externalId === channel.externalId) return;
    router.replace(liveHref(target.key, target.name, group));
  };
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
      {list.length > 1 && at >= 0 ? (
        <XStack gap="$2">
          <IconButton label="Previous channel" onPress={() => zap(-1)}>
            <ChevronUp size={28} color="white" />
          </IconButton>
          <IconButton label="Next channel" onPress={() => zap(1)}>
            <ChevronDown size={28} color="white" />
          </IconButton>
        </XStack>
      ) : null}
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
  return (
    <YStack self="flex-end" bg="rgba(20, 20, 20, 0.92)" rounded="$4" p="$2" minW={220} maxW={360}>
      {kind === 'subtitles' ? <TrackRow label="Off" onPress={() => onChoose(null)} /> : null}
      {tracks.map((track) => (
        <TrackRow key={track.id} label={track.label} onPress={() => onChoose(track.id)} />
      ))}
    </YStack>
  );
}

function TrackRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <SizableText size="$4" color="white" px="$3" py="$2" numberOfLines={1}>
        {label}
      </SizableText>
    </Pressable>
  );
}

function IconButton({
  label,
  onPress,
  disabled,
  big,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  big?: boolean;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      style={{ opacity: disabled ? 0.4 : 1, padding: big ? 12 : 6 }}
    >
      {children}
    </Pressable>
  );
}

function Notice({ message, onRetry, players }: { message: string; onRetry?: () => void; players?: boolean }) {
  return (
    <YStack flex={1} items="center" justify="center" gap="$4" px="$6">
      <XStack position="absolute" t="$5" l="$4">
        <IconButton label="Close the player" onPress={close}>
          <X size={26} color="white" />
        </IconButton>
      </XStack>
      <SizableText size="$5" color="white" text="center" maxW={520}>
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

/** The sheet a button opens over the controls: speed, chapters, tracks. */
function Panel({ children }: { children: ReactNode }) {
  return (
    <YStack self="flex-end" bg="rgba(20, 20, 20, 0.92)" rounded="$4" p="$2" minW={220} maxW={360} maxH={260} overflow="scroll">
      {children}
    </YStack>
  );
}

function PanelRow({ label, chosen, onPress }: { label: string; chosen: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <SizableText size="$4" color={chosen ? '$accent9' : 'white'} fontWeight={chosen ? '700' : '400'} px="$3" py="$2" numberOfLines={1}>
        {label}
      </SizableText>
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
 */
function usePlayerLeaving(controller: MediaPlayer | undefined, live: boolean) {
  const { data } = useAppSettings();
  const { pictureInPicture: platform } = useServices();
  const wanted = (data ?? APP_DEFAULTS).pictureInPicture && !live;
  const backgroundPlayback = (data ?? APP_DEFAULTS).backgroundPlayback;
  const [shrunk, setShrunk] = useState(false);

  useEffect(() => {
    if (!controller) return;
    // Two ways in, and a platform may have both. On Android the activity
    // shrinks, so it is asked once for whatever is playing; on iPhone only an
    // engine that draws into a layer the system can take has anything to give.
    controller.setPictureInPicture?.(wanted);
    controller.setBackgroundPlayback?.(backgroundPlayback);
    platform.setAutoEnter(wanted);
    return () => platform.setAutoEnter(false);
  }, [controller, wanted, backgroundPlayback, platform]);

  // In that window there is room for the picture and nothing else.
  useEffect(() => platform.subscribe(setShrunk), [platform]);

  return shrunk;
}
