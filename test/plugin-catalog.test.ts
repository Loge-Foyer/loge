import { PLATFORMS, PLUGIN_CATEGORIES, pluginId, type Plugin, type PluginManifest } from '@loge/api';
import { describe, expect, it } from 'vitest';

import { plugins } from '@/composition/plugins';
import { createPluginCatalog } from '@/services/plugin-catalog';
import { kindsForTab, showsOn } from '@/services/tab-content';

const quiet = { strict: true, warn: () => undefined } as const;

function manifest(id: string, rest: Partial<PluginManifest> & Pick<PluginManifest, 'category' | 'platforms'>): Plugin {
  return {
    manifest: {
      id: pluginId(id),
      displayName: id,
      description: `The ${id} plugin.`,
      connectionFields: [],
      settings: [],
      ...rest,
    },
  };
}

const library = manifest('sources/library', {
  category: 'sources',
  platforms: ['ios', 'android', 'web'],
  media: { contentKinds: ['movies', 'shows', 'live'], capabilities: [] },
});
const portal = manifest('iptv/portal', {
  category: 'iptv',
  platforms: ['ios', 'android'],
  media: { contentKinds: ['live', 'movies', 'shows'], capabilities: [] },
});
const player = manifest('players/engine', { category: 'players', platforms: ['ios'], player: { profiles: {} } });

describe('the plugin catalogue', () => {
  it('holds only the plugins that run on its platform', () => {
    const phone = createPluginCatalog([library, portal, player], { platform: 'ios', ...quiet });
    const browser = createPluginCatalog([library, portal, player], { platform: 'web', ...quiet });
    expect(phone.list().map(({ id }) => id)).toEqual(['iptv/portal', 'players/engine', 'sources/library']);
    expect(browser.list().map(({ id }) => id)).toEqual(['sources/library']);
    // A connection the account holds for a plugin that cannot run here is simply not usable here.
    expect(browser.get(portal.manifest.id)).toBeUndefined();
  });

  it('lists each category apart, for its list in Settings → Adapters', () => {
    const phone = createPluginCatalog([library, portal, player], { platform: 'ios', ...quiet });
    expect(phone.inCategory('iptv').map(({ id }) => id)).toEqual(['iptv/portal']);
    expect(phone.inCategory('sync')).toEqual([]);
  });

  it('offers for a tab only the plugins that show something on it', () => {
    const phone = createPluginCatalog([library, portal, player], { platform: 'ios', ...quiet });
    expect(phone.showingOn('media').map(({ id }) => id)).toEqual(['sources/library']);
    expect(phone.showingOn('videos')).toEqual([]);
    expect(phone.showingOn('tv').map(({ id }) => id)).toEqual(['iptv/portal', 'sources/library']);
  });
});

describe('where content appears', () => {
  it('puts a source’s library on Media, its videos and files on Videos, its channels on TV', () => {
    const kinds = ['movies', 'shows', 'anime', 'videos', 'files', 'live'] as const;
    expect(kindsForTab('media', 'sources', kinds)).toEqual(['movies', 'shows', 'anime']);
    expect(kindsForTab('videos', 'sources', kinds)).toEqual(['videos', 'files']);
    expect(kindsForTab('tv', 'sources', kinds)).toEqual(['live']);
  });

  it('keeps everything IPTV brings on TV — its films and series never reach the library', () => {
    const kinds = ['live', 'movies', 'shows'] as const;
    expect(kindsForTab('media', 'iptv', kinds)).toEqual([]);
    expect(kindsForTab('videos', 'iptv', kinds)).toEqual([]);
    expect(kindsForTab('tv', 'iptv', kinds)).toEqual(['live', 'movies', 'shows']);
  });

  it('shows nothing of a player or a sync plugin, whatever it declares', () => {
    for (const category of ['players', 'sync'] as const) {
      for (const tab of ['media', 'videos', 'tv'] as const) expect(showsOn(tab, category, ['movies', 'live'])).toBe(false);
    }
  });
});

describe('the plugins this app ships', () => {
  it('are sound, and each platform has sources, players and sync plugins', () => {
    for (const platform of PLATFORMS) {
      const catalog = createPluginCatalog(plugins, { platform, ...quiet });
      for (const category of PLUGIN_CATEGORIES) {
        if (category === 'iptv' && platform === 'web') continue;
        expect(catalog.inCategory(category).length, `${category} on ${platform}`).toBeGreaterThan(0);
      }
    }
  });

  it('offer no real IPTV provider in a browser, where providers cannot be reached', () => {
    // The pretend portal has no portal to be refused by: in development it runs in a browser too.
    expect(createPluginCatalog(plugins, { platform: 'web', ...quiet }).inCategory('iptv').map((manifest) => manifest.id)).toEqual(['iptv/mock']);
  });
});
