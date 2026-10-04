import { connectionId, type Channel } from '@loge/api';
import { describe, expect, it } from 'vitest';

import { backStep, liveOverlay, zapTarget, type LiveOverlayState } from '@/screens/player-layers';

const none = { channels: false, panel: false, controls: false, banner: false };

describe('Back in the player', () => {
  it('closes the layer on top first, and leaves last', () => {
    expect(backStep({ ...none, channels: true, panel: true, controls: true, banner: true }, true)).toBe('channels');
    expect(backStep({ ...none, panel: true, controls: true }, true)).toBe('panel');
    expect(backStep({ ...none, controls: true, banner: true }, true)).toBe('controls');
    expect(backStep({ ...none, banner: true }, true)).toBe('banner');
    expect(backStep(none, true)).toBe('leave');
  });

  it('leaves at once where nothing can close: a notice, or a phone with only the controls up', () => {
    expect(backStep(undefined, true)).toBe('leave');
    expect(backStep({ ...none, controls: true, banner: true }, false)).toBe('leave');
    // A phone still closes what slid in or opened.
    expect(backStep({ ...none, channels: true }, false)).toBe('channels');
    expect(backStep({ ...none, panel: true }, false)).toBe('panel');
  });
});

describe('A live channel on a TV', () => {
  const at = (change: Partial<LiveOverlayState>): LiveOverlayState => ({ state: 'playing', starting: false, controls: false, banner: false, recovering: false, channels: false, ...change });

  it('shows the banner while it opens, loads, buffers or reconnects — never the controls', () => {
    expect(liveOverlay(at({ starting: true, state: 'idle' }))).toBe('banner');
    expect(liveOverlay(at({ state: 'loading' }))).toBe('banner');
    expect(liveOverlay(at({ state: 'buffering' }))).toBe('banner');
    expect(liveOverlay(at({ recovering: true, state: 'ended' }))).toBe('banner');
  });

  it('shows the banner for its moment, the controls on select, and the picture alone after', () => {
    expect(liveOverlay(at({ banner: true }))).toBe('banner');
    expect(liveOverlay(at({ banner: true, controls: true }))).toBe('controls');
    expect(liveOverlay(at({}))).toBe('none');
  });

  it('keeps the controls up while paused or ended for good, and nothing over the channel list', () => {
    expect(liveOverlay(at({ state: 'paused' }))).toBe('controls');
    expect(liveOverlay(at({ state: 'ended' }))).toBe('controls');
    expect(liveOverlay(at({ channels: true, state: 'loading', banner: true }))).toBe('none');
  });
});

describe('Zapping', () => {
  const channel = (id: string): Channel => ({ key: { connectionId: connectionId('c'), externalId: id }, name: id, groupIds: [] });
  const list = ['1', '2', '3'].map(channel);

  it('goes to the channel above or below, round the group once it is all in', () => {
    expect(zapTarget(list, '2', -1, false)).toEqual({ kind: 'channel', channel: list[0] });
    expect(zapTarget(list, '2', 1, false)).toEqual({ kind: 'channel', channel: list[2] });
    expect(zapTarget(list, '3', 1, false)).toEqual({ kind: 'channel', channel: list[0] });
    expect(zapTarget(list, '1', -1, false)).toEqual({ kind: 'channel', channel: list[2] });
  });

  it('asks for the next page past the last one loaded, and goes nowhere above the first meanwhile', () => {
    expect(zapTarget(list, '3', 1, true)).toEqual({ kind: 'more' });
    expect(zapTarget(list, '1', -1, true)).toEqual({ kind: 'none' });
  });

  it('goes nowhere from a channel not found yet, or alone in its group', () => {
    expect(zapTarget(list, '9', 1, false)).toEqual({ kind: 'none' });
    expect(zapTarget([channel('1')], '1', 1, false)).toEqual({ kind: 'none' });
  });
});
