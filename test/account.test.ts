import { readFileSync } from 'node:fs';

import {
  connectionId,
  DEFAULT_MAX_PROFILES,
  isAccountRecord,
  MAX_RECORD_LENGTH,
  pluginId,
  recordKey,
  userId,
  type AccountRecord,
} from '@sc/api';
import { describe, expect, it } from 'vitest';

// The same file the server's tests read, so both sides judge a record alike.
const fixtures = JSON.parse(readFileSync(new URL('../api/fixtures/account-records.json', import.meta.url), 'utf8')) as {
  readonly valid: readonly unknown[];
  readonly invalid: readonly { readonly why: string; readonly record: unknown }[];
};

describe('isAccountRecord', () => {
  it.each(fixtures.valid.map((record) => [JSON.stringify(record).slice(0, 80), record] as const))('accepts %s', (_, record) => {
    expect(isAccountRecord(record)).toBe(true);
  });

  it.each(fixtures.invalid.map(({ why, record }) => [why, record] as const))('refuses %s', (_, record) => {
    expect(isAccountRecord(record)).toBe(false);
  });

  it('refuses a record heavier than the limit', () => {
    const heavy: AccountRecord = {
      kind: 'preference',
      key: 'u1/homeLayout',
      deleted: false,
      data: { userId: userId('u1'), name: 'homeLayout', value: 'x'.repeat(MAX_RECORD_LENGTH) },
    };
    expect(isAccountRecord(heavy)).toBe(false);
  });

  it('refuses what is not an object', () => {
    for (const value of [null, undefined, 'profile', 42, []]) expect(isAccountRecord(value)).toBe(false);
  });
});

describe('recordKey', () => {
  it('is the id, or the natural key', () => {
    expect(recordKey('profile', { userId: userId('u1'), name: 'Alex' })).toBe('u1');
    expect(recordKey('pin', { userId: userId('u1'), pin: null })).toBe('u1');
    expect(recordKey('preference', { userId: userId('u1'), name: 'homeLayout', value: null })).toBe('u1/homeLayout');
    expect(
      recordKey('profileValues', {
        connectionId: connectionId('c1'),
        userId: userId('u1'),
        off: false,
        fields: {},
        settings: {},
        secretKeys: [],
        secrets: {},
      }),
    ).toBe('c1/u1');
    expect(
      recordKey('connection', {
        connectionId: connectionId('c1'),
        pluginId: pluginId('sources/jellyfin'),
        label: 'Home',
        enabled: true,
        perProfile: 'none',
        fields: {},
        settings: {},
        secretKeys: [],
        secrets: {},
      }),
    ).toBe('c1');
  });
});

describe('the profile limit', () => {
  it('is ten unless the server says otherwise', () => {
    expect(DEFAULT_MAX_PROFILES).toBe(10);
  });
});
