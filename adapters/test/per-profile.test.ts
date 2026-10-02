import {
  connectionId,
  credentialsRef,
  isSetUpFor,
  missingPerProfile,
  perProfileKeys,
  perProfileModes,
  pluginId,
  resolveValues,
  type Connection,
  type PluginManifest,
} from '@loge/api';
import { describe, expect, it } from 'vitest';

const manifest: PluginManifest = {
  id: pluginId('sources/fixture'),
  category: 'sources',
  platforms: ['ios', 'android', 'web'],
  displayName: 'Fixture',
  description: 'A plugin that exists only in tests.',
  media: { contentKinds: ['movies'], capabilities: ['libraries'] },
  connectionFields: [
    { key: 'serverUrl', label: 'Server', type: 'url', required: true },
    { key: 'localOnly', label: 'Local only', type: 'boolean', default: true },
    { key: 'username', label: 'User', type: 'text', required: true, credential: true },
    { key: 'password', label: 'Password', type: 'password' },
  ],
  settings: [
    { key: 'cacheMetadata', label: 'Cache', type: 'boolean', default: true },
    { key: 'libraries', label: 'Libraries', type: 'libraries', default: { mode: 'all' } },
  ],
};

const shared = {
  fields: { serverUrl: 'http://home:8096', localOnly: true, username: 'family' },
  settings: { cacheMetadata: true },
  credentialsRef: credentialsRef('shared-ref'),
  secretKeys: ['password'],
};

function connection(perProfile: Connection['perProfile']): Connection {
  return {
    id: connectionId('c1'),
    pluginId: manifest.id,
    label: 'Home',
    enabled: true,
    perProfile,
    values: shared,
  };
}

describe('perProfileKeys', () => {
  it('keeps nothing per profile under none', () => {
    const keys = perProfileKeys(manifest, 'none');
    expect([...keys.fields, ...keys.settings]).toEqual([]);
  });

  it('keeps credential fields and every password per profile under credentials', () => {
    const keys = perProfileKeys(manifest, 'credentials');
    expect([...keys.fields]).toEqual(['username', 'password']);
    expect([...keys.settings]).toEqual([]);
  });

  it('keeps every field and setting per profile under all', () => {
    const keys = perProfileKeys(manifest, 'all');
    expect([...keys.fields]).toEqual(['serverUrl', 'localOnly', 'username', 'password']);
    expect([...keys.settings]).toEqual(['cacheMetadata', 'libraries']);
  });
});

describe('perProfileModes', () => {
  it('offers credentials only when a field is a credential', () => {
    expect(perProfileModes(manifest)).toEqual(['none', 'credentials', 'all']);
    const withoutAccount = { ...manifest, connectionFields: [manifest.connectionFields[0]!] };
    expect(perProfileModes(withoutAccount)).toEqual(['none', 'all']);
  });

  it('offers nothing to split when there is nothing to fill in', () => {
    expect(perProfileModes({ ...manifest, connectionFields: [], settings: [] })).toEqual(['none']);
  });
});

describe('resolveValues', () => {
  const own = {
    fields: { username: 'alex', serverUrl: 'http://ignored' },
    settings: { cacheMetadata: false },
    credentialsRef: credentialsRef('alex-ref'),
    secretKeys: ['password'],
  };

  it('uses the shared values as they are under none', () => {
    expect(resolveValues(manifest, connection('none'), own)).toEqual(shared);
  });

  it('takes only the per-profile keys from the profile, and its secrets', () => {
    expect(resolveValues(manifest, connection('credentials'), own)).toEqual({
      fields: { serverUrl: 'http://home:8096', localOnly: true, username: 'alex' },
      settings: { cacheMetadata: true },
      credentialsRef: 'alex-ref',
      secretKeys: ['password'],
    });
  });

  it('takes every value from the profile under all', () => {
    const resolved = resolveValues(manifest, connection('all'), own);
    expect(resolved.fields).toEqual({ username: 'alex', serverUrl: 'http://ignored' });
    expect(resolved.settings).toEqual({ cacheMetadata: false });
  });

  it('never falls back to the shared secret for a profile without its own', () => {
    const resolved = resolveValues(manifest, connection('credentials'), undefined);
    expect(resolved.credentialsRef).toBeUndefined();
    expect(resolved.fields.username).toBeUndefined();
  });
});

describe('isSetUpFor', () => {
  it('counts every profile as set up under none', () => {
    expect(isSetUpFor(manifest, connection('none'), undefined)).toBe(true);
  });

  it('needs the profile’s own values otherwise', () => {
    expect(isSetUpFor(manifest, connection('credentials'), undefined)).toBe(false);
    expect(isSetUpFor(manifest, connection('credentials'), { fields: {}, settings: {} })).toBe(false);
    expect(isSetUpFor(manifest, connection('credentials'), { fields: { username: 'kid' }, settings: {} })).toBe(true);
  });

  it('counts a required password once its name is saved', () => {
    const strict: PluginManifest = {
      ...manifest,
      connectionFields: manifest.connectionFields.map((field) =>
        field.type === 'password' ? { ...field, required: true } : field,
      ),
    };
    const values = { fields: { username: 'kid' }, settings: {} };
    expect(missingPerProfile(strict, 'credentials', values)).toEqual(['password']);
    expect(isSetUpFor(strict, connection('credentials'), { ...values, secretKeys: ['password'] })).toBe(true);
  });

  it('asks for the shared fields too under all', () => {
    expect(missingPerProfile(manifest, 'all', { fields: { username: 'kid' }, settings: {} })).toEqual(['serverUrl']);
  });
});
