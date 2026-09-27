import {
  accountCarries,
  connectionId,
  defaultRoles,
  isSyncChange,
  MAX_CHANGE_LENGTH,
  pluginId,
  syncKey,
  userId,
  type PluginManifest,
  type SyncChange,
} from '@sc/api';
import { describe, expect, it } from 'vitest';

const alex = userId('u-alex');
const home = connectionId('c-home');

const valid: readonly SyncChange[] = [
  { id: 'c1', changedAt: 1, entity: 'profile', operation: 'upsert', data: { userId: alex, name: 'Alex' } },
  { id: 'c2', changedAt: 2, entity: 'profile', operation: 'delete', target: { userId: alex } },
  { id: 'c3', changedAt: 3, entity: 'pin', operation: 'upsert', data: { userId: alex, pin: '0427' } },
  { id: 'c4', changedAt: 4, entity: 'pin', operation: 'upsert', data: { userId: alex, pin: null } },
  {
    id: 'c5',
    changedAt: 5,
    entity: 'preferences',
    operation: 'upsert',
    data: { userId: alex, key: 'homeLayout', value: { version: 1, rows: [{ id: 'continue', hidden: false }] } },
  },
  { id: 'c6', changedAt: 6, entity: 'preferences', operation: 'delete', target: { userId: alex, key: 'homeLayout' } },
  {
    id: 'c7',
    changedAt: 7,
    entity: 'connection',
    operation: 'upsert',
    data: {
      connectionId: home,
      pluginId: pluginId('jellyfin'),
      label: 'Home',
      media: true,
      perProfile: 'credentials',
      fields: { serverUrl: 'http://home:8096', localOnly: true },
      settings: { libraries: { mode: 'only', ids: ['films'] } },
      secretKeys: [],
    },
  },
  { id: 'c8', changedAt: 8, entity: 'connection', operation: 'delete', target: { connectionId: home } },
  {
    id: 'c9',
    changedAt: 9,
    entity: 'profileValues',
    operation: 'upsert',
    data: { connectionId: home, userId: alex, off: false, fields: { username: 'alex' }, settings: {}, secretKeys: ['password'] },
  },
  { id: 'c10', changedAt: 10, entity: 'profileValues', operation: 'delete', target: { connectionId: home, userId: alex } },
];

describe('isSyncChange', () => {
  it('accepts every entity and operation the contract allows', () => {
    for (const change of valid) expect(isSyncChange(change), change.id).toBe(true);
  });

  it('refuses what is not a change', () => {
    for (const value of [null, 'change', 42, [], {}]) expect(isSyncChange(value)).toBe(false);
  });

  it('refuses a change without a usable id or time', () => {
    const [profile] = valid;
    expect(isSyncChange({ ...profile, id: '' })).toBe(false);
    expect(isSyncChange({ ...profile, id: 7 })).toBe(false);
    expect(isSyncChange({ ...profile, changedAt: Number.NaN })).toBe(false);
    expect(isSyncChange({ ...profile, changedAt: '1' })).toBe(false);
  });

  it('refuses a PIN that is not four digits, and a PIN deleted on its own', () => {
    for (const pin of ['123', '12345', 'abcd', 1234, undefined]) {
      expect(isSyncChange({ id: 'p', changedAt: 1, entity: 'pin', operation: 'upsert', data: { userId: alex, pin } })).toBe(false);
    }
    expect(isSyncChange({ id: 'p', changedAt: 1, entity: 'pin', operation: 'delete', target: { userId: alex } })).toBe(false);
  });

  it('refuses ids that could pass for another key', () => {
    expect(
      isSyncChange({ id: 'x', changedAt: 1, entity: 'profile', operation: 'upsert', data: { userId: 'a/b', name: 'Alex' } }),
    ).toBe(false);
  });

  it('refuses values that are not JSON, and field values of the wrong kind', () => {
    expect(
      isSyncChange({
        id: 'x',
        changedAt: 1,
        entity: 'preferences',
        operation: 'upsert',
        data: { userId: alex, key: 'homeLayout', value: { when: () => 0 } },
      }),
    ).toBe(false);
    expect(
      isSyncChange({
        id: 'x',
        changedAt: 1,
        entity: 'profileValues',
        operation: 'upsert',
        data: { connectionId: home, userId: alex, off: false, fields: { port: 8096 }, settings: {}, secretKeys: [] },
      }),
    ).toBe(false);
  });

  it('refuses an unknown entity, operation or connection mode', () => {
    const [profile, , , , , , connection] = valid;
    expect(isSyncChange({ ...profile, entity: 'watchProgress' })).toBe(false);
    expect(isSyncChange({ ...profile, operation: 'replace' })).toBe(false);
    if (connection?.operation !== 'upsert') throw new Error('fixture');
    expect(isSyncChange({ ...connection, data: { ...connection.data, perProfile: 'everyone' } })).toBe(false);
  });

  it('refuses a profile with an empty name, and secret names that are not keys', () => {
    expect(
      isSyncChange({ id: 'x', changedAt: 1, entity: 'profile', operation: 'upsert', data: { userId: alex, name: '  ' } }),
    ).toBe(false);
    const [, , , , , , , , values] = valid;
    if (values?.operation !== 'upsert') throw new Error('fixture');
    expect(isSyncChange({ ...values, data: { ...values.data, secretKeys: ['pass word'] } })).toBe(false);
  });
});

describe('isSyncChange — sealed passwords', () => {
  const [, , , , , , connection, , values] = valid;
  if (connection?.operation !== 'upsert' || connection.entity !== 'connection') throw new Error('fixture');
  if (values?.operation !== 'upsert' || values.entity !== 'profileValues') throw new Error('fixture');
  const sealedConnection = (sealed: unknown, secretKeys: readonly string[] = ['password']) => ({
    ...connection,
    data: { ...connection.data, secretKeys, sealed },
  });

  it('accepts sealed values for the passwords a connection or a profile lists', () => {
    expect(isSyncChange(sealedConnection({ password: 'v1.a1b2.QUJDRA' }))).toBe(true);
    expect(isSyncChange({ ...values, data: { ...values.data, sealed: { password: 'v1.a1b2.QUJDRA' } } })).toBe(true);
  });

  it('lets a newer version through, for the app to leave unopened', () => {
    expect(isSyncChange(sealedConnection({ password: 'v2.x.y.z' }))).toBe(true);
  });

  it('refuses a sealed value for a password the change does not list', () => {
    expect(isSyncChange(sealedConnection({ password: 'v1.a.b' }, []))).toBe(false);
    expect(isSyncChange(sealedConnection({ other: 'v1.a.b' }))).toBe(false);
  });

  it('refuses a sealed value without its version, in another alphabet, or too long', () => {
    for (const bad of ['a1b2.QUJDRA', 'v0.a.b', 'v1.', 'v1.a+b', 'v1.a/b', `v1.${'a'.repeat(5_000)}`, 42, null]) {
      expect(isSyncChange(sealedConnection({ password: bad })), String(bad).slice(0, 12)).toBe(false);
    }
    expect(isSyncChange(sealedConnection('v1.a.b'))).toBe(false);
  });

  it('refuses a change heavier than both sides allow', () => {
    const heavy = (length: number): SyncChange => ({
      id: 'h',
      changedAt: 1,
      entity: 'preferences',
      operation: 'upsert',
      data: { userId: alex, key: 'homeLayout', value: 'x'.repeat(length) },
    });
    expect(isSyncChange(heavy(1_000))).toBe(true);
    expect(isSyncChange(heavy(MAX_CHANGE_LENGTH))).toBe(false);
  });
});

describe('syncKey', () => {
  it('names what a change is about, the same for an upsert and a delete', () => {
    expect(valid.map(syncKey)).toEqual([
      'profile/u-alex',
      'profile/u-alex',
      'pin/u-alex',
      'pin/u-alex',
      'preferences/u-alex/homeLayout',
      'preferences/u-alex/homeLayout',
      'connection/c-home',
      'connection/c-home',
      'profileValues/c-home/u-alex',
      'profileValues/c-home/u-alex',
    ]);
  });
});

describe('accountCarries', () => {
  it('needs every capability an entity depends on', () => {
    const profilesOnly = new Set(['profile'] as const);
    expect(accountCarries(profilesOnly, 'profile')).toBe(true);
    expect(accountCarries(profilesOnly, 'pin')).toBe(true);
    expect(accountCarries(profilesOnly, 'preferences')).toBe(false);
    expect(accountCarries(profilesOnly, 'profileValues')).toBe(false);
    const connectionsOnly = new Set(['providerConnections'] as const);
    expect(accountCarries(connectionsOnly, 'connection')).toBe(true);
    expect(accountCarries(connectionsOnly, 'profileValues')).toBe(false);
  });
});

describe('defaultRoles', () => {
  const base = { id: pluginId('fixture'), displayName: 'Fixture', description: 'A fixture.', connectionFields: [], settings: [] };

  it('switches media on and never sync, whatever the plugin declares', () => {
    const both: PluginManifest = { ...base, media: { contentKinds: ['files'], capabilities: [] }, sync: { capabilities: [] } };
    const syncOnly: PluginManifest = { ...base, sync: { capabilities: [] } };
    expect(defaultRoles(both)).toEqual({ media: true, sync: false });
    expect(defaultRoles(syncOnly)).toEqual({ sync: false });
  });
});
