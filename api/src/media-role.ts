import type { MediaCapability } from './capabilities';
import type { PluginContext, PluginTarget } from './context';
import type { CancelSignal } from './http';
import type { ConnectionId } from './ids';
import type { ChannelGroup, ChannelPage, ChannelQuery, GuideQuery, Programme } from './live';
import type { GlobalMediaKey, HeadersRef, ImageRef, ImageSource, Library, MediaDetail, MediaItem } from './media';
import type { PlaybackDescriptor, PlaybackRequest, ProgressReport } from './playback';
import type { ItemPage, ItemQuery } from './query';

/** One connection's values, resolved for the profile it runs for. */
export type MediaTarget = PluginTarget;

export type MediaContext = PluginContext;

export interface SourceInfo {
  readonly serverName?: string;
  readonly version?: string;
}

export interface ImageSize {
  readonly width: number;
  readonly height?: number;
}

/**
 * A connected media source. The optional members mirror the capabilities
 * (`MEDIA_CAPABILITY_MEMBERS`): the app calls one only while its capability is
 * in effect. Calls overlap, so work such as signing in must happen once.
 */
export interface ConnectedMediaProvider {
  readonly connectionId: ConnectionId;
  /** Reaches the source and signs in — the connection form's "Test connection". */
  check(signal?: CancelSignal): Promise<SourceInfo>;
  /** Pages in exactly `compareItems(query.sort)` order, within the connection's own libraries setting. */
  listItems?(query: ItemQuery, signal?: CancelSignal): Promise<ItemPage>;
  getItem?(externalId: string, signal?: CancelSignal): Promise<MediaDetail>;
  /** A show's seasons, or a season's episodes. */
  getChildren?(parent: MediaItem, signal?: CancelSignal): Promise<ItemPage>;
  getLibraries?(signal?: CancelSignal): Promise<readonly Library[]>;
  /** Items in progress, most recently played first. */
  getResume?(limit: number, signal?: CancelSignal): Promise<readonly MediaItem[]>;
  /** Builds an address, so it never waits. `null` when there is nothing to show. */
  resolveImage?(ref: ImageRef, size: ImageSize): ImageSource | null;
  resolveHeaders?(ref: HeadersRef): Promise<Readonly<Record<string, string>> | undefined>;
  listChannelGroups?(signal?: CancelSignal): Promise<readonly ChannelGroup[]>;
  /** Pages in the provider's own channel order. */
  listChannels?(query: ChannelQuery, signal?: CancelSignal): Promise<ChannelPage>;
  getGuide?(query: GuideQuery, signal?: CancelSignal): Promise<readonly Programme[]>;
  /** What to play, for the engine the request describes. Its addresses are held in memory only. */
  getPlaybackDescriptor?(request: PlaybackRequest, signal?: CancelSignal): Promise<PlaybackDescriptor>;
  /**
   * Where playback got to: started, progress, stopped. The app's outbox
   * delivers these, and may deliver one twice after a lost answer, so a report
   * must be safe to repeat.
   */
  reportPlayback?(report: ProgressReport, signal?: CancelSignal): Promise<void>;
  /** Watched, or not, as the user said. Safe to repeat, like a report. */
  setPlayed?(key: GlobalMediaKey, played: boolean, signal?: CancelSignal): Promise<void>;
  dispose(): Promise<void>;
}

/** Connecting does no network work; signing in waits for the first call. */
export interface MediaRole {
  connect(target: MediaTarget, context: MediaContext): Promise<ConnectedMediaProvider>;
}

/** The members each media capability promises. Capabilities absent here promise none yet. */
export const MEDIA_CAPABILITY_MEMBERS: Readonly<
  Partial<Record<MediaCapability, readonly (keyof ConnectedMediaProvider)[]>>
> = {
  browse: ['listItems', 'getItem', 'getChildren'],
  libraries: ['getLibraries'],
  watchStateRead: ['getResume'],
  remoteImages: ['resolveImage'],
  channels: ['listChannelGroups', 'listChannels'],
  epg: ['getGuide'],
  playback: ['getPlaybackDescriptor'],
  watchStateWrite: ['reportPlayback', 'setPlayed'],
};
