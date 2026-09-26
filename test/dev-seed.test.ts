import { describe, expect, it } from 'vitest';

import { devSeedIds } from '@/composition/dev-seed';
import type { IdGenerator } from '@/services/ports';

const firstThree = (ids: IdGenerator) => [ids.next(), ids.next(), ids.next()];

describe('a seeded development build', () => {
  it('creates the same ids on every launch, so a real server sees one device', () => {
    expect(firstThree(devSeedIds('jellyfin'))).toEqual(firstThree(devSeedIds('jellyfin')));
  });

  it('never hands out the same id twice in one launch', () => {
    expect(new Set(firstThree(devSeedIds('jellyfin'))).size).toBe(3);
  });
});
