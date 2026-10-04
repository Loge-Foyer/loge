import { AppError } from '@loge/api';
import { describe, expect, it } from 'vitest';

import { nextTryIn, recoverable } from '@/services/live-recovery';

describe('A live channel coming back by itself', () => {
  it('comes back from an end, a stall, or a failure to try again later', () => {
    expect(recoverable('ended', undefined)).toBe(true);
    expect(recoverable('stalled', undefined)).toBe(true);
    expect(recoverable('failed', new AppError('PROVIDER_UNAVAILABLE', 'The stream stopped.', { retry: 'backoff' }))).toBe(true);
  });

  it('never after a refusal, a failure not to repeat, one that waits for a network, or one it cannot read', () => {
    expect(recoverable('failed', new AppError('UNAUTHORIZED', 'Refused.', { retry: 'backoff' }))).toBe(false);
    expect(recoverable('failed', new AppError('NOT_FOUND', 'Gone.', { retry: 'never' }))).toBe(false);
    expect(recoverable('failed', new AppError('OFFLINE', 'No network.', { retry: 'network-change' }))).toBe(false);
    expect(recoverable('failed', new Error('Something else.'))).toBe(false);
    expect(recoverable('playing', undefined)).toBe(false);
  });

  it('tries three times, further apart each time, then stops', () => {
    expect([0, 1, 2, 3].map(nextTryIn)).toEqual([1_000, 4_000, 10_000, undefined]);
  });
});
