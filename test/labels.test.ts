import { describe, expect, it } from 'vitest';

import { describeSourceError, describeSyncStatus, timeAgo } from '@/components/labels';

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

  it('asks for the password when this device has none — after a restore, or on a connection the account brought', () => {
    expect(describeSourceError({ label: 'Home', code: 'UNAUTHORIZED', retry: 'never', needsPassword: true })).toBe(
      'Home needs its password on this device. Enter it in Settings.',
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

describe('describing how the account stands', () => {
  const now = 1_000_000_000;

  it('says when it last synced, and how many changes wait to be sent', () => {
    expect(describeSyncStatus({ phase: 'synced', lastSyncedAt: now - 5 * 60_000, pending: 0 }, now)).toBe('Synced 5 min ago');
    expect(describeSyncStatus({ phase: 'synced', lastSyncedAt: now, pending: 2 }, now)).toBe('Synced just now · 2 changes waiting');
  });

  it('tells a refused sign-in from a password this device does not have', () => {
    const refused = { code: 'UNAUTHORIZED', message: 'No.', retry: 'never' } as const;
    expect(describeSyncStatus({ phase: 'needs-sign-in', pending: 1, problem: refused }, now)).toBe('Needs you to sign in again · 1 change waiting');
    expect(describeSyncStatus({ phase: 'needs-sign-in', pending: 0, problem: { ...refused, needsPassword: true } }, now)).toBe(
      'Needs its password on this device',
    );
  });

  it('tells being offline from a network the account cannot be reached on, and from a retry', () => {
    expect(describeSyncStatus({ phase: 'waiting', pending: 0, problem: { code: 'OFFLINE', message: '', retry: 'network-change' } }, now)).toBe(
      'Offline — syncs when a network is back',
    );
    expect(describeSyncStatus({ phase: 'waiting', pending: 0, problem: { code: 'TIMEOUT', message: '', retry: 'network-change' } }, now)).toBe(
      'Can’t be reached on this network',
    );
    expect(describeSyncStatus({ phase: 'waiting', pending: 0, problem: { code: 'PROVIDER_UNAVAILABLE', message: '', retry: 'backoff' } }, now)).toBe(
      'Couldn’t sync — trying again soon',
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
