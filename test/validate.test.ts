import { pluginId, validateManifest, type PluginManifest } from '@sc/api';
import { describe, expect, it } from 'vitest';

const sound: PluginManifest = {
  id: pluginId('fixture'),
  displayName: 'Fixture',
  description: 'A plugin that exists only in tests.',
  media: { contentKinds: ['videos'], capabilities: ['home'] },
  sync: { capabilities: ['watchProgress'] },
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

  it('rejects a sync capability without a toggle', () => {
    expect(problemsWith({ settings: [] })).toContain('sync capability "watchProgress" has no toggle');
  });

  it('rejects a sync toggle that defaults to on', () => {
    const problems = problemsWith({
      settings: [
        { key: 'syncWatchProgress', label: 'Progress', type: 'boolean', default: true, gates: ['sync.watchProgress'] },
      ],
    });
    expect(problems).toContain('setting "syncWatchProgress" gates sync and must default to false');
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
          gates: ['sync.watchProgress', 'media.home'],
        },
      ],
    });
    expect(problems).toContain('setting "syncEverything" gates more than one role');
  });
});
