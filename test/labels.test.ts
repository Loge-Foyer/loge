import { describe, expect, it } from 'vitest';

import { describeSourceError } from '@/components/labels';

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
});
