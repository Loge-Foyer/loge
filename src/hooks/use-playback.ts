import type { AppError, AudioTrack, ConnectionId, Episode, GlobalMediaKey, MediaItem, MediaPlayer, PlayerEvent, PlayerState, PluginId, SubtitleTrack } from '@loge/api';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { APP_DEFAULTS } from '@/services/app-settings';
import type { PlaybackPlan } from '@/services/playback';
import type { PlaybackReports } from '@/services/playback-reports';
import { remoteKey } from '@/services/query-keys';

import { useServices } from './services-context';
import { useAppSettings } from './use-app-settings';
import { useActiveUserId } from './use-session';

/**
 * Which player plays the item, and what. Kept in this screen's state and
 * nowhere else — never in the query cache: a descriptor's addresses can
 * carry credentials. Asked afresh each time the screen opens.
 */
export function usePlaybackPlan(key: GlobalMediaKey | undefined, options: { readonly startMs?: number; readonly live?: boolean; readonly player?: PluginId } = {}) {
  const userId = useActiveUserId();
  const { playback } = useServices();
  const [result, setResult] = useState<{ readonly request: string; readonly plan?: PlaybackPlan; readonly error?: Error }>();
  const [attempt, setAttempt] = useState(0);
  const { startMs, live = false, player } = options;
  // The item's identity, not the object: a refetched detail page must not ask again.
  const request = key ? `${key.connectionId}/${key.externalId}/${startMs ?? 0}/${live ? 'live' : ''}/${player ?? ''}/${attempt}` : undefined;
  const ask = useEffectEvent((signal: AbortSignal) =>
    key
      ? playback.plan(userId, key, { ...(startMs === undefined ? {} : { startMs }), ...(live ? { live } : {}), ...(player ? { player } : {}) }, signal)
      : Promise.resolve(undefined),
  );

  useEffect(() => {
    if (!request) return;
    const abort = new AbortController();
    ask(abort.signal).then(
      (plan) => {
        if (!abort.signal.aborted && plan) setResult({ request, plan });
      },
      (error: unknown) => {
        if (!abort.signal.aborted) setResult({ request, error: error instanceof Error ? error : new Error(String(error)) });
      },
    );
    return () => abort.abort();
  }, [request]);

  const current = result?.request === request ? result : undefined;
  return { plan: current?.plan, error: current?.error, retry: () => setAttempt((count) => count + 1) };
}

export interface PlayerSnapshot {
  readonly state: PlayerState;
  readonly positionMs: number;
  readonly durationMs?: number;
  readonly audio: readonly AudioTrack[];
  readonly subtitles: readonly SubtitleTrack[];
  readonly error?: AppError;
}

const IDLE: PlayerSnapshot = { state: 'idle', positionMs: 0, audio: [], subtitles: [] };

function next(snapshot: PlayerSnapshot, event: PlayerEvent): PlayerSnapshot {
  switch (event.type) {
    case 'state': {
      // A new load clears the last failure; a failure keeps its error beside it.
      const { error, ...rest } = snapshot;
      return { ...rest, state: event.state, ...(event.state !== 'loading' && error ? { error } : {}) };
    }
    case 'position':
      return { ...snapshot, positionMs: event.positionMs, ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }) };
    case 'tracks':
      return { ...snapshot, audio: event.audio, subtitles: event.subtitles };
    case 'error':
      return { ...snapshot, error: event.error };
  }
}

interface Session {
  readonly plan: PlaybackPlan;
  readonly controller: MediaPlayer;
  readonly snapshot: PlayerSnapshot;
}

/**
 * The chosen player's controller, made for this plan, loaded and started.
 *
 * It is made inside the effect, never kept across one: Fast Refresh and
 * React's strict mode run effects twice, and a controller disposed in one run
 * and reused in the next hands the native view a player that is gone. It
 * reaches the screen through its own events — subscribing tells the current
 * state at once — and belongs to its plan: a new plan never renders the old
 * one's controller, which is released a moment later.
 */
export function usePlayer(plan: PlaybackPlan | undefined, connectionId: ConnectionId, onEvent: (event: PlayerEvent) => void) {
  const userId = useActiveUserId();
  const { playback } = useServices();
  const [session, setSession] = useState<Session>();
  const heard = useEffectEvent(onEvent);
  const { data: settings } = useAppSettings();
  // Read as the engine is made, so a change takes effect the next time
  // something plays rather than halfway through a film.
  const preferences = useEffectEvent(() => ({ softwareFallback: (settings ?? APP_DEFAULTS).softwareFallback }));

  useEffect(() => {
    if (plan?.kind !== 'play') return;
    const player = playback.create(userId, plan.player, connectionId, preferences());
    const unsubscribe = player.subscribe((event) => {
      heard(event);
      setSession((current) => ({ plan, controller: player, snapshot: next(current?.controller === player ? current.snapshot : IDLE, event) }));
    });
    let active = true;
    const { startMs } = plan.descriptor;
    player.load({ source: plan.source, ...(startMs ? { startMs } : {}) }).then(
      () => {
        if (active) player.play();
      },
      // A failed load arrives as an error event too.
      () => undefined,
    );
    return () => {
      active = false;
      unsubscribe();
      // Once the view has let go of it: released first, a native view would hold a player that is gone.
      setTimeout(() => void player.dispose(), 0);
    };
  }, [playback, userId, connectionId, plan]);

  const current = session?.plan === plan ? session : undefined;
  return { controller: current?.controller, snapshot: current?.snapshot ?? IDLE };
}

/** Where playing gets to, reported as it goes — one session per item, made in the effect for the reason `usePlayer` gives. */
export function usePlaybackReports(item: MediaItem | undefined, live: boolean, startMs?: number) {
  const userId = useActiveUserId();
  const { playback } = useServices();
  const reports = useRef<PlaybackReports | undefined>(undefined);
  const begin = useEffectEvent(() => (item ? playback.reports(userId, item, live, startMs) : undefined));
  const connectionId = item?.key.connectionId;
  const externalId = item?.key.externalId;

  useEffect(() => {
    if (!connectionId || !externalId) return;
    const session = begin();
    reports.current = session;
    return () => {
      if (reports.current === session) reports.current = undefined;
      void session?.stop();
    };
  }, [connectionId, externalId, live]);

  return (event: PlayerEvent) => reports.current?.event(event);
}

/** The episode after this one, for the player's Next episode. */
export function useNextEpisode(episode: Episode | undefined) {
  const userId = useActiveUserId();
  const { playback } = useServices();
  return useQuery({
    queryKey: remoteKey(userId, 'next', episode?.key.connectionId, episode?.key.externalId),
    queryFn: async ({ signal }) => (episode ? ((await playback.nextEpisode(userId, episode, signal)) ?? null) : null),
    enabled: episode !== undefined,
    staleTime: 5 * 60_000,
  });
}

/** Any way the device is held while this screen is open; upright again after. */
export function usePlayerOrientation() {
  const { orientation, appSettings } = useServices();
  useEffect(() => {
    let left = false;
    void (async () => {
      const { forceLandscape } = await appSettings.get().catch(() => APP_DEFAULTS);
      // The screen may have been left while the setting was being read.
      if (left) return;
      await (forceLandscape ? orientation.landscape() : orientation.free()).catch(() => undefined);
    })();
    return () => {
      left = true;
      void orientation.upright().catch(() => undefined);
    };
  }, [orientation, appSettings]);
}
