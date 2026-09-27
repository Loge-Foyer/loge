import { describe, expect, it } from 'vitest';

import { describeSourceError, timeAgo } from '@/components/labels';

describe('describing a source that could not answer', () => {
  it('says a home server is skipped on mobile data', () => {
    expect(describeSourceError({ label: 'Home', code: 'OFFLINE', retry: 'network-change', reason: 'local-network-only' })).toBe(
      'Home is only used on your home network.',
    );
  });

  it('says a parked source waits for another network, without claiming mobile data', () => {
    expect(describeSourceError({ label: 'Home', code: 'TIMEOUT', retry: 'network-change' })).toBe(
      'Home can’t be reached on this network.',
    );
  });

  it('asks for the password again when the saved one is gone from the device', () => {
    expect(describeSourceError({ label: 'Home', code: 'UNAUTHORIZED', retry: 'never', needsPassword: true })).toBe(
      'Home needs its password again. Enter it in Settings.',
    );
  });

  it('falls back to what the code means', () => {
    expect(describeSourceError({ label: 'Home', code: 'TIMEOUT', retry: 'backoff' })).toBe('Home took too long to answer.');
    expect(describeSourceError({ label: 'Home', code: 'OFFLINE', retry: 'network-change' })).toBe('Home is not reachable right now.');
  });

  it('says how old the saved titles standing in for a source are', () => {
    const now = Date.UTC(2026, 8, 27, 12);
    expect(describeSourceError({ label: 'Home', code: 'OFFLINE', retry: 'network-change', savedAt: now - 5 * 60_000 }, now)).toBe(
      'Home is not reachable right now. Showing what was saved 5 min ago.',
    );
  });
});

describe('how long ago', () => {
  const now = Date.UTC(2026, 8, 27, 12);
  it('counts in minutes, then hours, then days', () => {
    expect(timeAgo(now - 20_000, now)).toBe('just now');
    expect(timeAgo(now - 59 * 60_000, now)).toBe('59 min ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(timeAgo(now - 30 * 3_600_000, now)).toBe('yesterday');
    expect(timeAgo(now - 12 * 86_400_000, now)).toBe('12 days ago');
    expect(timeAgo(now + 60_000, now)).toBe('just now');
  });
});
