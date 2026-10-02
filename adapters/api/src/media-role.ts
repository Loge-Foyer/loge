import type { MediaCapability } from './capabilities';
import type { PluginContext, PluginTarget } from './context';
import type { DownloadDescriptor, DownloadOption, DownloadRequest } from './download';
import type { CancelSignal } from './http';
import type { ConnectionId } from './ids';
import type { ChannelGroup, ChannelPage, ChannelQuery, GuideQuery, Programme } from './live';
import type { GlobalMediaKey, HeadersRef, ImageRef, ImageSource, Library, MediaDetail, MediaItem } from './media';
import type { PlaybackDescriptor, PlaybackRequest, ProgressReport } from './playback';
import type { ChildQuery, ItemPage, ItemQuery } from './query';

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
  /**
   * A show's seasons, a season's episodes, a channel's or a playlist's videos.
   * Where the item has `sections` or pages, `query` says which, and the
   * answer's `nextCursor` leads on; a source with neither may ignore it.
   */
  getChildren?(parent: MediaItem, signal?: CancelSignal, query?: ChildQuery): Promise<ItemPage>;
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
  /**
   * The newest from these channels, merged by the source and ordered as
   * `ItemQuery.sort` asks. The app holds the channel list — it is the
   * profile's, not the server's — and hands it over on each call.
   */
  listFeed?(externalIds: readonly string[], query: ItemQuery, signal?: CancelSignal): Promise<ItemPage>;
  /**
   * The versions this item can be kept as. Cheap enough to ask while drawing a
   * sheet of choices; `getDownloadDescriptor` is the expensive half.
   */
  listDownloadOptions?(key: GlobalMediaKey, signal?: CancelSignal): Promise<readonly DownloadOption[]>;
  /**
   * How to fetch one copy. The address may expire or carry a token, so it is
   * asked for when the download starts and again when it resumes — never
   * stored.
   */
  getDownloadDescriptor?(request: DownloadRequest, signal?: CancelSignal): Promise<DownloadDescriptor>;
  reportPlayback?(report: ProgressReport, signal?: CancelSignal): Promise<void>;
  /** Watched, or not, as the user said. Safe to repeat, like a report. */
  setPlayed?(key: GlobalMediaKey, played: boolean, signal?: CancelSignal): Promise<void>;
  dispose(): Promise<void>;
}

/** Connecting does no network work; signing in waits for the first call. */
export interface MediaRole {
  connect(target: MediaTarget, context: MediaContext): Promise<ConnectedMediaProvider>;
}

/**
 * The members each media capability promises. Capabilities absent here promise
 * none yet — and `search` promises none on purpose: it is not a call of its
 * own but a promise about the ones already here. A source that declares it
 * honours `ItemQuery.term`, and `ChannelQuery.term` as well where it declares
 * `channels`. Searching therefore pages, sorts and merges exactly as browsing
 * does, and the app needs no second path through any of it.
 */
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
  feed: ['listFeed'],
  downloads: ['getDownloadDescriptor'],
  downloadOptions: ['listDownloadOptions'],
};
