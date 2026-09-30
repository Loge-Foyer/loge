import { connectionId, credentialsRef, pluginId, userId, type PluginManifest } from '@sc/api';
import { describe, expect, it } from 'vitest';

import { createSessions, sessionIdentity, sessionRef } from '@/services/sessions';

import { memoryCredentialStore } from './support/fakes';

const manifest: PluginManifest = {
  id: pluginId('sources/fixture'),
  category: 'sources',
  platforms: ['ios', 'android', 'web'],
  displayName: 'Fixture',
  description: 'Test.',
  media: { contentKinds: ['movies'], capabilities: [] },
  connectionFields: [
    { key: 'serverUrl', label: 'Server', type: 'url' },
    { key: 'username', label: 'User', type: 'text', credential: true },
    { key: 'password', label: 'Password', type: 'password' },
  ],
  settings: [{ key: 'cacheMetadata', label: 'Cache', type: 'boolean', default: true }],
};

describe('sessions', () => {
  const values = { fields: { serverUrl: 'http://home', username: 'alex' }, settings: {}, credentialsRef: credentialsRef('ref-1') };

  it('keeps a token for the credentials it was made with', async () => {
    const sessions = createSessions(memoryCredentialStore());
    const store = sessions.bind(connectionId('c1'), 'shared', sessionIdentity(manifest, values));
    await store.write('token');
    await expect(sessions.bind(connectionId('c1'), 'shared', sessionIdentity(manifest, values)).read()).resolves.toBe('token');
  });

  it('drops the token once the address, the username or the password changes', async () => {
    const sessions = createSessions(memoryCredentialStore());
    for (const changed of [
      { ...values, fields: { ...values.fields, serverUrl: 'http://elsewhere' } },
      { ...values, fields: { ...values.fields, username: 'kid' } },
      { ...values, credentialsRef: credentialsRef('ref-2') },
    ]) {
      await sessions.bind(connectionId('c1'), 'shared', sessionIdentity(manifest, values)).write('token');
      await expect(sessions.bind(connectionId('c1'), 'shared', sessionIdentity(manifest, changed)).read()).resolves.toBeUndefined();
    }
  });

  it('keeps the token when only a setting changes', () => {
    expect(sessionIdentity(manifest, { ...values, settings: { cacheMetadata: false } })).toBe(sessionIdentity(manifest, values));
  });

  it('keeps each profile’s session apart, under a ref anyone can derive', async () => {
    const store = memoryCredentialStore();
    const sessions = createSessions(store);
    const identity = sessionIdentity(manifest, values);
    await sessions.bind(connectionId('c1'), userId('alex'), identity).write('alex-token');
    await expect(sessions.bind(connectionId('c1'), userId('kid'), identity).read()).resolves.toBeUndefined();
    await store.delete(sessionRef(connectionId('c1'), userId('alex')));
    await expect(sessions.bind(connectionId('c1'), userId('alex'), identity).read()).resolves.toBeUndefined();
  });
});
