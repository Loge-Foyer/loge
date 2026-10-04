import { describe, expect, it } from 'vitest';

import { rowLayout, shiftOf, slotStart, TV_ROW_CARDS } from '@/tabs/media/tv/row-layout';

describe('a TV row', () => {
  const layout = rowLayout(240, 24, 80, 1920);

  it('widens the focused card from a poster to a scene at the poster’s height', () => {
    expect(layout).toMatchObject({ poster: 240, height: 360, scene: 640, slot: 264, shift: 400, inset: 80 });
  });

  it('keeps every slot where it is, whichever card has the focus', () => {
    expect([0, 1, 5].map((index) => slotStart(layout, index))).toEqual([80, 344, 1400]);
  });

  it('moves along only the cards after the focused one, and none while the row has no focus', () => {
    expect([0, 1, 2, 3].map((index) => shiftOf(layout, index, 1))).toEqual([0, 0, 400, 400]);
    expect(shiftOf(layout, 3, undefined)).toBe(0);
  });

  it('leaves room after the last slot for it to be scrolled to the margin, so the focused card is always on the left', () => {
    // The last slot can start at the margin: the row's width, less the margin, less the slot itself.
    expect(layout.trailing).toBe(1920 - 80 - 264);
    // A row too narrow for that still leaves the last card room to widen.
    expect(rowLayout(240, 24, 80, 600).trailing).toBe(80 + 400);
    expect(TV_ROW_CARDS).toBe(20);
  });
});
