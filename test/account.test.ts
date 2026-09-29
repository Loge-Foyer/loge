import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  connectionId,
  DEFAULT_MAX_PROFILES,
  isAccountRecord,
  MAX_RECORD_LENGTH,
  pluginId,
  recordId,
  recordKey,
  userId,
  type AccountRecord,
  type RecordKind,
} from '@sc/api';
import { describe, expect, it } from 'vitest';

// The same file the server's tests read, so both sides judge a record alike.
const fixtures = JSON.parse(readFileSync(new URL('../api/fixtures/account-records.json', import.meta.url), 'utf8')) as {
  readonly valid: readonly unknown[];
  readonly invalid: readonly { readonly why: string; readonly record: unknown }[];
  readonly recordIds: readonly { readonly accountId: string; readonly kind: RecordKind; readonly key: string; readonly id: string }[];
};

const sha256 = async (data: Uint8Array) => new Uint8Array(createHash('sha256').update(data).digest());

describe('recordId', () => {
  // The server derives the same, from the same vectors: the first profile it creates must be the one a device writes.
  it.each(fixtures.recordIds.map((vector) => [`${vector.kind} ${vector.key}`, vector] as const))('derives %s', async (_, vector) => {
    expect(await recordId(sha256, vector.accountId, vector.kind, vector.key)).toBe(vector.id);
  });

  it('answers what PocketBase takes for an id', async () => {
    expect(await recordId(sha256, 'k4r9x2m1q8w3e5t', 'profile', 'u1')).toMatch(/^[a-z0-9]{15}$/);
  });
});

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
