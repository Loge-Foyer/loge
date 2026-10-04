import type { Channel, PlayerState } from '@loge/api';

/**
 * What Back does in the player: the layer on top closes, and the player goes
 * last. On a TV the controls and a channel's banner are layers too — the
 * remote's Back hides them before it leaves — where a phone's Back leaves the
 * player with them showing.
 */
export type BackStep = 'channels' | 'panel' | 'controls' | 'banner' | 'leave';

export interface PlayerLayers {
  /** A channel's group, slid in from the left. */
  readonly channels: boolean;
  /** Audio, subtitles, speed or chapters, open beneath the controls. */
  readonly panel: boolean;
  /** The controls, where hiding them shows the picture — never while a pause or a load keeps them up. */
  readonly controls: boolean;
  /** A channel's name and what is on, over the picture, where hiding it shows the picture. */
  readonly banner: boolean;
}

/** What Back closes, as the layers stand; `undefined` — a failure's notice, say — is nothing to close. */
export function backStep(layers: PlayerLayers | undefined, tv: boolean): BackStep {
  if (!layers) return 'leave';
  if (layers.channels) return 'channels';
  if (layers.panel) return 'panel';
  if (tv && layers.controls) return 'controls';
  if (tv && layers.banner) return 'banner';
  return 'leave';
}

/** What a TV shows over a live channel: its banner, the controls, or the picture alone. */
export type LiveOverlay = 'banner' | 'controls' | 'none';

export interface LiveOverlayState {
  readonly state: PlayerState;
  /** No engine yet: the link is still being made. */
  readonly starting: boolean;
  /** Select asked for the controls, and they have not timed out. */
  readonly controls: boolean;
  /** The banner's seconds after the channel began playing, or after a press of right. */
  readonly banner: boolean;
  /** Coming back by itself after its stream stopped. */
  readonly recovering: boolean;
  /** The channel's group is open over the picture. */
  readonly channels: boolean;
}

/**
 * Up and down zap on a TV, so a live channel is watched with the controls
 * away: opening or zapping shows the banner, and only select brings the
 * controls. Loading, buffering and reconnecting keep the banner up, with a
 * spinner; a pause, or a stream that ended for good, the controls.
 */
export function liveOverlay(now: LiveOverlayState): LiveOverlay {
  if (now.channels) return 'none';
  if (now.controls) return 'controls';
  if (now.recovering) return 'banner';
  if (now.state === 'paused' || now.state === 'ended') return 'controls';
  if (now.starting || now.state === 'idle' || now.state === 'loading' || now.state === 'buffering') return 'banner';
  return now.banner ? 'banner' : 'none';
}

export type ZapTarget = { readonly kind: 'channel'; readonly channel: Channel } | { readonly kind: 'more' } | { readonly kind: 'none' };

/**
 * The channel `offset` places from `from` in a lineup. Past the last one
 * loaded comes the next page's turn: round to the first only once the whole
 * group is in, and nothing above the first while it is not — the group's last
 * is not known yet.
 */
export function zapTarget(list: readonly Channel[], from: string, offset: number, more: boolean): ZapTarget {
  const at = list.findIndex((each) => each.key.externalId === from);
  if (at < 0 || list.length < 2) return { kind: 'none' };
  const index = at + offset;
  if (more && index >= list.length) return { kind: 'more' };
  if (more && index < 0) return { kind: 'none' };
  const channel = list[((index % list.length) + list.length) % list.length];
  return channel && channel.key.externalId !== from ? { kind: 'channel', channel } : { kind: 'none' };
}
