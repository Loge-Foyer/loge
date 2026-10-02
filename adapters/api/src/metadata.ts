import type { PluginContext, PluginTarget } from './context';
import type { ContentKind } from './content';
import type { CancelSignal } from './http';
import type { ConnectionId } from './ids';
import type { ExternalIds } from './media';
import type { SourceInfo } from './media-role';

/**
 * What a film or a series is, by its name — for a source that carries no
 * catalogue id of its own, such as a portal keeping a copy of a film for each
 * language, each under its own name. A metadata adapter answers with a
 * catalogue's ids, and `watchIdentity` keys watch status by them: every copy
 * is then one film.
 */

/** What a metadata adapter can name. */
export const IDENTIFIABLE_KINDS = ['movies', 'shows'] as const satisfies readonly ContentKind[];

export type IdentifiableKind = (typeof IDENTIFIABLE_KINDS)[number];

export interface MetadataManifest {
  /** Films, series, or both. */
  readonly identifies: readonly IdentifiableKind[];
}

/** A title as its source names it, without the marks a provider adds to it — "DE", "4K", "(1999)". */
export interface IdentifyQuery {
  readonly type: 'movie' | 'show';
  readonly title: string;
  /** The title in its own language, where the source knows it apart. */
  readonly originalTitle?: string;
  readonly year?: number;
}

export interface ConnectedMetadataProvider {
  readonly connectionId: ConnectionId;
  /** Tries the key once: Test connection. */
  check(signal?: CancelSignal): Promise<SourceInfo>;
  /**
   * The catalogue's ids for what the query names, or nothing where no match is
   * close enough to be sure of. A wrong answer is worse than none: it would
   * merge one film's watch status into another's.
   */
  identify(query: IdentifyQuery, signal?: CancelSignal): Promise<ExternalIds | undefined>;
  dispose(): Promise<void>;
}

/** Connecting does no network work; the key is first tried by the first call. */
export interface MetadataRole {
  connect(target: PluginTarget, context: PluginContext): Promise<ConnectedMetadataProvider>;
}

/** The members every connected metadata provider has. */
export const METADATA_MEMBERS = ['check', 'identify', 'dispose'] as const satisfies readonly (keyof ConnectedMetadataProvider)[];
