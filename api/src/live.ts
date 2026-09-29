import type { GlobalMediaKey, ImageRef } from './media';

/** Live TV, as an IPTV plugin — or a source with a tuner — brings it. */

export interface ChannelGroup {
  readonly id: string;
  readonly name: string;
}

export interface Channel {
  readonly key: GlobalMediaKey;
  readonly name: string;
  /** The provider's own numbering, where it has one. */
  readonly number?: number;
  readonly groupIds: readonly string[];
  readonly logo?: ImageRef;
  /** How many days back the provider keeps, for catch-up. Absent when it keeps none. */
  readonly catchupDays?: number;
}

export interface Programme {
  readonly channel: GlobalMediaKey;
  readonly title: string;
  readonly description?: string;
  /** ISO 8601. */
  readonly startsAt: string;
  readonly endsAt: string;
  readonly image?: ImageRef;
}

export interface ChannelQuery {
  /** Only this group's channels; every channel without it. */
  readonly groupId?: string;
  readonly limit: number;
  /** Opaque, from the previous page. */
  readonly cursor?: string;
}

/** A page of channels, in the provider's own order. */
export interface ChannelPage {
  readonly channels: readonly Channel[];
  readonly nextCursor?: string;
  readonly total?: number;
}

export interface GuideQuery {
  readonly channels: readonly GlobalMediaKey[];
  /** ISO 8601; the guide covers what airs between them. */
  readonly from: string;
  readonly to: string;
}
