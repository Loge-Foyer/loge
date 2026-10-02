import { CATEGORY_SCOPE, categoryOfPluginId, isQualifiedPluginId, PLUGIN_CATEGORIES, qualifiedPluginId, runsOn } from '@loge/api';
import { describe, expect, it } from 'vitest';

describe('qualified plugin ids', () => {
  it('puts the category before the name, as the folder does', () => {
    expect(qualifiedPluginId('sources', 'jellyfin')).toBe('sources/jellyfin');
    expect(qualifiedPluginId('sync', 'google-drive')).toBe('sync/google-drive');
  });

  it('refuses a name that is not kebab-case', () => {
    expect(() => qualifiedPluginId('iptv', 'Stalker Portal')).toThrow();
    expect(() => qualifiedPluginId('iptv', 'a/b')).toThrow();
  });

  it('reads the category back, and nothing from an id without one', () => {
    expect(categoryOfPluginId('iptv/stalker')).toBe('iptv');
    expect(categoryOfPluginId('players/system')).toBe('players');
    expect(categoryOfPluginId('metadata/tmdb')).toBe('metadata');
    for (const id of ['jellyfin', 'movies/jellyfin', 'sources/', 'sources/Jellyfin', 'sources/a/b', '/jellyfin']) {
      expect(categoryOfPluginId(id), id).toBeUndefined();
      expect(isQualifiedPluginId(id), id).toBe(false);
    }
  });
});

describe('scope', () => {
  it('keeps sources, IPTV and metadata with the account, players and sync on the device', () => {
    expect(PLUGIN_CATEGORIES.map((category) => [category, CATEGORY_SCOPE[category]])).toEqual([
      ['sources', 'account'],
      ['iptv', 'account'],
      ['players', 'device'],
      ['sync', 'device'],
      ['metadata', 'account'],
    ]);
  });
});

describe('runsOn', () => {
  it('follows the manifest, and takes one that names no platform to run everywhere', () => {
    expect(runsOn({ platforms: ['ios'] }, 'ios')).toBe(true);
    expect(runsOn({ platforms: ['ios'] }, 'web')).toBe(false);
    expect(runsOn({}, 'android')).toBe(true);
  });
});
