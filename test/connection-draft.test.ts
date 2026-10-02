import { pluginId, userId, type PluginManifest } from '@loge/api';
import { describe, expect, it } from 'vitest';

import {
  initialDraft,
  isOffInDraft,
  isSetUpInDraft,
  probeValues,
  setProfileOff,
  setSecret,
  setValue,
  switchMode,
  valueFor,
} from '@/services/connection-draft';
import type { SavedSecrets } from '@/services/connections';
import { hasErrors, validateDraft } from '@/services/field-values';

const manifest: PluginManifest = {
  id: pluginId('sources/fixture'),
  category: 'sources',
  platforms: ['ios', 'android', 'web'],
  displayName: 'Fixture',
  description: 'Test.',
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

const kids = userId('kids');
const alex = userId('alex');
const savedShared: SavedSecrets = { shared: new Set(['password']), profiles: new Map() };

function shared() {
  let draft = initialDraft(manifest, 0);
  draft = setValue(manifest, draft, kids, 'fields', 'serverUrl', 'http://home');
  return setValue(manifest, draft, kids, 'fields', 'username', 'family');
}

describe('switching modes', () => {
  it('gives the profile being edited the login everyone had, and nobody else', () => {
    const draft = switchMode(manifest, shared(), 'credentials', kids, savedShared);
    expect(draft.profiles[kids]).toEqual({ fields: { username: 'family' }, settings: {}, secrets: { password: { adopt: 'shared' } } });
    expect(draft.profiles[alex]).toBeUndefined();
    expect(isSetUpInDraft(manifest, draft, kids, savedShared)).toBe(true);
    expect(isSetUpInDraft(manifest, draft, alex, savedShared)).toBe(false);
  });

  it('keeps the address shared under credentials, and makes it per profile under all', () => {
    const credentials = switchMode(manifest, shared(), 'credentials', kids, savedShared);
    expect(valueFor(manifest, credentials, alex, 'fields', 'serverUrl')).toBe('http://home');
    const all = switchMode(manifest, credentials, 'all', kids, savedShared);
    expect(valueFor(manifest, all, kids, 'fields', 'serverUrl')).toBe('http://home');
    expect(valueFor(manifest, all, alex, 'fields', 'serverUrl')).toBeUndefined();
    // Defaults still show where a profile has not chosen.
    expect(valueFor(manifest, all, alex, 'fields', 'localOnly')).toBe(true);
  });

  it('makes the edited tab everyone’s when switching back to none', () => {
    let draft = switchMode(manifest, shared(), 'credentials', kids, savedShared);
    draft = setValue(manifest, draft, alex, 'fields', 'username', 'alex');
    draft = setSecret(draft, alex, 'password', 'alex-secret');
    const back = switchMode(manifest, draft, 'none', alex, savedShared);
    expect(back.shared.fields.username).toBe('alex');
    expect(back.shared.secrets.password).toBe('alex-secret');
  });

  it('switches a profile off, and back on with what it had', () => {
    const split = switchMode(manifest, shared(), 'credentials', kids, savedShared);
    const off = setProfileOff(split, kids, true);
    expect(isOffInDraft(off, kids)).toBe(true);
    expect(isSetUpInDraft(manifest, off, kids, savedShared)).toBe(false);
    const on = setProfileOff(off, kids, false);
    expect(on.profiles[kids]).toEqual(split.profiles[kids]);
    expect(isSetUpInDraft(manifest, on, kids, savedShared)).toBe(true);
  });

  it('does not check an off profile, whose values are not saved', () => {
    const all = switchMode(manifest, shared(), 'all', kids, savedShared);
    const bad = setValue(manifest, all, alex, 'fields', 'serverUrl', 'not a url');
    expect(hasErrors(validateDraft(manifest, bad, savedShared))).toBe(true);
    expect(hasErrors(validateDraft(manifest, setProfileOff(bad, alex, true), savedShared))).toBe(false);
  });
});

describe('validating a draft', () => {
  it('requires the shared values but lets a profile stay unfinished', () => {
    const draft = switchMode(manifest, shared(), 'credentials', kids, savedShared);
    const unfinished = setValue(manifest, draft, alex, 'fields', 'username', '');
    expect(hasErrors(validateDraft(manifest, unfinished, savedShared))).toBe(false);
    const noServer = setValue(manifest, draft, kids, 'fields', 'serverUrl', '');
    expect(validateDraft(manifest, noServer, savedShared).shared.serverUrl).toBe('Server is required.');
  });

  it('checks the shape of per-profile values', () => {
    const all = switchMode(manifest, shared(), 'all', kids, savedShared);
    const badUrl = setValue(manifest, all, alex, 'fields', 'serverUrl', 'not a url');
    expect(validateDraft(manifest, badUrl, savedShared).profiles[alex]?.serverUrl).toContain('full address');
    const noLibraries = setValue(manifest, all, alex, 'settings', 'libraries', { mode: 'only', ids: [] });
    expect(validateDraft(manifest, noLibraries, savedShared).profiles[alex]?.libraries).toContain('at least one');
  });
});

describe('probing a draft', () => {
  it('uses the tab’s own values and the secrets of its scope', () => {
    const draft = setSecret(switchMode(manifest, shared(), 'credentials', kids, savedShared), kids, 'password', 'typed');
    expect(probeValues(manifest, draft, kids)).toEqual({
      fields: { serverUrl: 'http://home', localOnly: true, username: 'family' },
      settings: { cacheMetadata: true, libraries: { mode: 'all' } },
      scope: kids,
      secrets: { password: 'typed' },
    });
  });
});
