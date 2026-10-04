import { describe, expect, it } from 'vitest';

import { countedTvMenu } from '@/platform/tv-menu-count';

function counted(available = true) {
  const calls: string[] = [];
  const menu = countedTvMenu({
    available: () => available,
    enable: () => calls.push('enable'),
    disable: () => calls.push('disable'),
    native: (on) => calls.push(on ? 'hold' : 'give back'),
  });
  return { menu, calls };
}

describe('an Apple TV remote’s Menu, kept for the app', () => {
  it('is switched on by the first hold and given back with the last, however they overlap', () => {
    const { menu, calls } = counted();
    const player = menu.hold();
    const list = menu.hold();
    player();
    expect(calls).toEqual(['enable', 'hold', 'hold']);
    list();
    expect(calls).toEqual(['enable', 'hold', 'hold', 'give back', 'disable']);
  });

  it('takes UIKit’s handling again after a transition, only while held, and counts a release once', () => {
    const { menu, calls } = counted();
    menu.refresh();
    expect(calls).toEqual([]);
    const release = menu.hold();
    menu.refresh();
    release();
    release();
    expect(calls).toEqual(['enable', 'hold', 'hold', 'give back', 'disable']);
  });

  it('does nothing where there is no Menu button to keep', () => {
    const { menu, calls } = counted(false);
    menu.hold()();
    menu.refresh();
    expect(calls).toEqual([]);
  });
});
