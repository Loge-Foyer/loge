import { pluginId, validateManifest, type PluginManifest } from '@sc/api';
import { describe, expect, it } from 'vitest';

const sound: PluginManifest = {
  id: pluginId('fixture'),
  displayName: 'Fixture',
  description: 'A plugin that exists only in tests.',
  media: { contentKinds: ['videos'], capabilities: ['browse'] },
  sync: { capabilities: ['profile', 'watchProgress'] },
  connectionFields: [
    { key: 'serverUrl', label: 'Server URL', type: 'url', required: true },
    { key: 'password', label: 'Password', type: 'password' },
  ],
  settings: [
    { key: 'syncWatchProgress', label: 'Progress', type: 'boolean', default: false, gates: ['sync.watchProgress'] },
  ],
};

function problemsWith(overrides: Partial<PluginManifest>): readonly string[] {
  return validateManifest({ ...sound, ...overrides });
}

describe('validateManifest', () => {
  it('accepts a sound manifest', () => {
    expect(validateManifest(sound)).toEqual([]);
  });

  it('rejects a manifest with no role', () => {
    const { media: _media, sync: _sync, ...roleless } = sound;
    expect(validateManifest({ ...roleless, settings: [] })).toContain('declares no role');
  });

  it('rejects a media role that brings nothing', () => {
    expect(problemsWith({ media: { contentKinds: [], capabilities: [] } })).toContain(
      'media role brings no content kind',
    );
  });

  it('rejects duplicate keys within a list', () => {
    const problems = problemsWith({
      connectionFields: [
        { key: 'serverUrl', label: 'A', type: 'url' },
        { key: 'serverUrl', label: 'B', type: 'text' },
      ],
    });
    expect(problems).toContain('connection field key "serverUrl" is declared twice');
  });

  it('rejects a select whose default is not an option', () => {
    const problems = problemsWith({
      connectionFields: [
        { key: 'quality', label: 'Quality', type: 'select', default: 'best', options: [{ value: 'low', label: 'Low' }] },
      ],
    });
    expect(problems).toContain('select "quality" defaults to a missing option');
  });

  it('rejects a secret-looking field that is not a password field', () => {
    const problems = problemsWith({
      connectionFields: [{ key: 'apiToken', label: 'Token', type: 'text' }],
    });
    expect(problems).toContain('connection field "apiToken" looks secret but is not a password field');
  });

  // Signing in to an account is the opt-in: it carries what it declares.
  it('accepts a sync capability without a toggle', () => {
    expect(problemsWith({ settings: [] })).toEqual([]);
  });

  it('accepts a sync toggle that defaults to on', () => {
    const problems = problemsWith({
      settings: [
        { key: 'syncWatchProgress', label: 'Progress', type: 'boolean', default: true, gates: ['sync.watchProgress'] },
      ],
    });
    expect(problems).toEqual([]);
  });

  it('rejects a per-profile sync capability without profiles', () => {
    for (const capability of ['preferences', 'watchProgress', 'favorites', 'watchlist', 'history', 'customLists'] as const) {
      expect(problemsWith({ sync: { capabilities: [capability] }, settings: [] })).toContain(
        `sync capability "${capability}" needs "profile"`,
      );
    }
    expect(problemsWith({ sync: { capabilities: ['providerConnections'] }, settings: [] })).toEqual([]);
  });

  it('rejects a gate on an undeclared capability', () => {
    const problems = problemsWith({
      settings: [
        ...sound.settings,
        { key: 'showLive', label: 'Live', type: 'boolean', default: true, gates: ['media.live'] },
      ],
    });
    expect(problems).toContain('setting "showLive" gates undeclared "media.live"');
  });

  it('rejects a toggle that gates two roles', () => {
    const problems = problemsWith({
      settings: [
        {
          key: 'syncEverything',
          label: 'Everything',
          type: 'boolean',
          default: false,
          gates: ['sync.watchProgress', 'media.browse'],
        },
      ],
    });
    expect(problems).toContain('setting "syncEverything" gates more than one role');
  });
});

describe('validateManifest — libraries and credentials', () => {
  const libraries = { key: 'libraries', label: 'Libraries', type: 'libraries', default: { mode: 'all' } } as const;
  const withLibrariesCapability = { contentKinds: ['movies'], capabilities: ['browse', 'libraries'] } as const;

  it('accepts a libraries setting when the plugin can list its libraries', () => {
    expect(problemsWith({ media: withLibrariesCapability, settings: [...sound.settings, libraries] })).toEqual([]);
  });

  it('rejects a libraries setting without the libraries capability', () => {
    expect(problemsWith({ settings: [...sound.settings, libraries] })).toContain(
      'a libraries setting needs the media capability "libraries"',
    );
  });

  it('rejects two libraries settings', () => {
    const problems = problemsWith({
      media: withLibrariesCapability,
      settings: [...sound.settings, libraries, { ...libraries, key: 'moreLibraries' }],
    });
    expect(problems).toContain('declares more than one libraries setting');
  });

  it('rejects a libraries default that is not a selection', () => {
    const problems = problemsWith({
      media: withLibrariesCapability,
      settings: [...sound.settings, { ...libraries, default: { mode: 'only', ids: [42] } as never }],
    });
    expect(problems).toContain('libraries setting "libraries" has an invalid default');
  });

  it('rejects a setting marked as a credential', () => {
    const problems = problemsWith({
      settings: [...sound.settings, { key: 'accountName', label: 'Account', type: 'text', credential: true }],
    });
    expect(problems).toContain('setting "accountName" cannot be a credential; credentials are connection fields');
  });
});
