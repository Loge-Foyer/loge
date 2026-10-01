import {
  AppError,
  choosePlayer,
  missingFor,
  type CancelSignal,
  type ConnectionId,
  type Episode,
  type GlobalMediaKey,
  type MediaItem,
  type MediaPlayer,
  type PlaybackDescriptor,
  type PlaybackSource,
  type PlayerRequirement,
  type PluginCategory,
  type PluginId,
  type Show,
  type UserId,
  type PlayerPreferences,} from '@sc/api';
import type { PlayerPlugin, PlayerView } from '@sc/player-kit';

import type { MediaService } from './media';
import { playbackReports, type PlaybackReports } from './playback-reports';
import type { PlayerService } from './players';
import type { Clock } from './ports';
import { tabOfPlaying } from './tab-content';
import type { WatchService } from './watch';

/** What pressing Play comes to, on this device. */
export type PlaybackPlan =
  | {
      readonly kind: 'play';
      readonly player: PluginId;
      readonly source: PlaybackSource;
      /** Held in memory only: its addresses can carry credentials. */
      readonly descriptor: PlaybackDescriptor;
    }
  /** No player here plays any of the item's streams; `needs` is what the best one lacks. */
  | { readonly kind: 'none'; readonly needs: readonly PlayerRequirement[]; readonly source?: PlaybackSource }
  /** Every player is switched off on this device. */
  | { readonly kind: 'no-player' };

export interface PlaybackOptions {
  readonly startMs?: number;
  readonly audioTrackId?: string;
  readonly subtitleTrackId?: string;
  /** A channel, played live: it plays from TV, whoever brings it. */
  readonly live?: boolean;
  /** "Play with…": this player and no other, asked for by the user. */
  readonly player?: PluginId;
}

export interface PlaybackService {
  /**
   * The player that plays this item, and what it plays: the source is asked
   * for a stream fit for the player that plays first on the item's tab — a
   * server that transcodes shapes its answer to that player's profile — and
   * `choosePlayer` confirms it, or finds the player that can. A player the
   * user picked plays, or nothing does: it is never swapped for another.
   */
  plan(userId: UserId, key: GlobalMediaKey, options?: PlaybackOptions, signal?: CancelSignal): Promise<PlaybackPlan>;
  /** A controller for a chosen player. Whoever creates it disposes it. */
  create(userId: UserId, player: PluginId, connectionId: ConnectionId, preferences?: PlayerPreferences): MediaPlayer;
  /** The view that draws a player's controllers. */
  view(player: PluginId): PlayerView | undefined;
  /** The episode after this one — the next season's first, after a season's last. */
  nextEpisode(userId: UserId, episode: Episode, signal?: CancelSignal): Promise<Episode | undefined>;
  /** Where playing an item gets to, reported as it goes. One per session: made when it starts, stopped when it ends. */
  reports(userId: UserId, item: MediaItem, live: boolean, startMs?: number): PlaybackReports;
}

export function createPlaybackService(deps: {
  readonly players: readonly PlayerPlugin[];
  readonly choosing: PlayerService['choosing'];
  /** The category of a connection's plugin, which decides the tab its items play from. */
  readonly categoryOf: (connectionId: ConnectionId) => Promise<PluginCategory | undefined>;
  readonly media: Pick<MediaService, 'playbackDescriptor' | 'children' | 'artworkHeaders'>;
  readonly watch: Pick<WatchService, 'report'>;
  /** What is already on this device, which plays before anything is asked of a source. */
  readonly downloads: {
    ready(userId: UserId, key: GlobalMediaKey): Promise<PlaybackDescriptor | undefined>;
  };
  readonly clock: Pick<Clock, 'now'>;
}): PlaybackService {
  const { media } = deps;
  const pluginOf = (id: PluginId) => deps.players.find((player) => player.manifest.id === id);

  return {
    plan: async (userId, key, options = {}, signal) => {
      const { live = false, player, ...wanted } = options;
      const tab = tabOfPlaying(await deps.categoryOf(key.connectionId), live);
      const choosing = await deps.choosing(tab);
      const picked = player === undefined ? undefined : choosing.candidates.find((candidate) => candidate.id === player);
      if (player !== undefined && !picked) throw new AppError('NOT_FOUND', 'That player is switched off, or cannot play on this device.', { retry: 'never' });
      const candidates = picked ? [picked] : choosing.candidates;
      const preferred = picked?.id ?? choosing.preferred;
      const first = candidates.find((candidate) => candidate.id === preferred) ?? candidates[0];
      if (!first) return { kind: 'no-player' };
      // A copy on this device comes first: it plays in airplane mode, costs the
      // server nothing, and is what the user asked for by keeping it. Only when
      // one is finished — a half-written file is not something to open.
      const kept = await deps.downloads.ready(userId, key);
      const descriptor = kept ?? (await media.playbackDescriptor(userId, { key, profile: first.profile, ...wanted }, signal));
      const choice = choosePlayer(descriptor.sources, candidates, preferred);
      if (choice.kind === 'play') return { kind: 'play', player: choice.player, source: choice.source, descriptor };
      const best = descriptor.sources[0];
      return { kind: 'none', needs: best ? missingFor(first.profile, best) : [], ...(best ? { source: best } : {}) };
    },

    create: (userId, player, connectionId, preferences) => {
      const plugin = pluginOf(player);
      if (!plugin) throw new Error(`No engine for ${player} in this build.`);
      // A stream's headers come from its source, in memory, when the engine loads it.
      return plugin.player.create({
        resolveHeaders: (ref) => media.artworkHeaders(userId, connectionId, ref),
        ...(preferences === undefined ? {} : { preferences }),
      });
    },

    view: (player) => pluginOf(player)?.View,

    nextEpisode: async (userId, episode, signal) => {
      // The source needs no more of a series than its key to list its seasons.
      const show: Show = { type: 'show', key: episode.show, title: episode.showTitle, ratings: {}, genres: [], images: {} };
      const seasons = (await media.children(userId, show, signal)).items;
      const at = seasons.findIndex((season) => season.key.externalId === episode.season?.externalId);
      for (const season of at >= 0 ? seasons.slice(at) : []) {
        const episodes = (await media.children(userId, season, signal)).items.filter((item): item is Episode => item.type === 'episode');
        if (season === seasons[at]) {
          const index = episodes.findIndex((item) => item.key.externalId === episode.key.externalId);
          const next = index >= 0 ? episodes[index + 1] : undefined;
          if (next) return next;
          continue;
        }
        if (episodes[0]) return episodes[0];
      }
      return undefined;
    },

    reports: (userId, item, live, startMs) =>
      playbackReports({ watch: deps.watch, clock: deps.clock, userId, item, live, ...(startMs === undefined ? {} : { startMs }) }),
  };
}
