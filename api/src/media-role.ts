import type { MediaCapability } from './capabilities';
import type { Credentials, FieldValues } from './fields';
import type { CancelSignal, HttpClient } from './http';
import type { ConnectionId } from './ids';
import type { HeadersRef, ImageRef, ImageSource, Library, MediaDetail, MediaItem } from './media';
import type { ItemPage, ItemQuery } from './query';

/** One connection's values, resolved for the profile it runs for. */
export interface MediaTarget {
  readonly connectionId: ConnectionId;
  readonly fields: FieldValues;
  readonly settings: FieldValues;
}

export type NetworkKind = 'wifi' | 'ethernet' | 'cellular' | 'other' | 'none' | 'unknown';

/**
 * Everything a plugin may use from its host. Plugins have no host globals —
 * no fetch, no timers, no storage — so a test can hand them fakes, and the app
 * keeps secrets, logging and the network in one place.
 */
export interface MediaContext {
  readonly http: HttpClient;
  /** The target's password-field values. */
  readonly credentials: { read(): Promise<Credentials> };
  /**
   * A secret the plugin may keep between launches, such as a session token.
   * The app scopes it to this connection and these credentials, and drops it
   * when either changes.
   */
  readonly session: {
    read(): Promise<string | undefined>;
    write(value: string): Promise<void>;
    clear(): Promise<void>;
  };
  readonly network: { current(): NetworkKind };
  readonly client: {
    readonly appName: string;
    readonly appVersion: string;
    readonly deviceName: string;
    /** Stable for this device, this connection and this set of credentials. */
    readonly installationId: string;
  };
  readonly clock: {
    now(): number;
    sleep(ms: number, signal?: CancelSignal): Promise<void>;
  };
}

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
};
