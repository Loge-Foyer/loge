import { effectiveCapabilities, pluginId, type PluginManifest } from '@sc/api';
import { describe, expect, it } from 'vitest';

const manifest: PluginManifest = {
  id: pluginId('sources/fixture'),
  category: 'sources',
  platforms: ['ios', 'android', 'web'],
  displayName: 'Fixture',
  description: 'A plugin that exists only in tests.',
  media: { contentKinds: ['movies', 'shows'], capabilities: ['browse', 'search', 'watchStateWrite', 'offlineMetadata'] },
  connectionFields: [],
  settings: [
    { key: 'reportProgress', label: 'Report', type: 'boolean', default: true, gates: ['media.watchStateWrite'] },
    { key: 'cacheMetadata', label: 'Keep', type: 'boolean', default: false, gates: ['media.offlineMetadata'] },
  ],
};

describe('effectiveCapabilities', () => {
  it('puts nothing in effect for a connection switched off', () => {
    expect(effectiveCapabilities(manifest, { enabled: false, settings: {} })).toEqual({ media: null });
  });

  it('keeps ungated capabilities and passes content kinds through', () => {
    const { media } = effectiveCapabilities(manifest, { enabled: true, settings: {} });
    expect(media?.contentKinds).toEqual(['movies', 'shows']);
    expect(media?.capabilities).toEqual(new Set(['browse', 'search', 'watchStateWrite']));
  });

  it('drops a capability whose toggle is switched off', () => {
    const { media } = effectiveCapabilities(manifest, { enabled: true, settings: { reportProgress: false } });
    expect(media?.capabilities).toEqual(new Set(['browse', 'search']));
  });

  it('falls back to a toggle’s default when nothing is stored, and takes what is', () => {
    expect(effectiveCapabilities(manifest, { enabled: true, settings: {} }).media?.capabilities.has('offlineMetadata')).toBe(false);
    expect(effectiveCapabilities(manifest, { enabled: true, settings: { cacheMetadata: true } }).media?.capabilities.has('offlineMetadata')).toBe(true);
  });

  it('ignores a stored value of the wrong type', () => {
    const { media } = effectiveCapabilities(manifest, { enabled: true, settings: { cacheMetadata: 'yes' } });
    expect(media?.capabilities.has('offlineMetadata')).toBe(false);
  });

  it('puts nothing in effect for a plugin without a media block', () => {
    const { media: _media, ...rest } = manifest;
    expect(effectiveCapabilities({ ...rest, settings: [] }, { enabled: true, settings: {} }).media).toBeNull();
  });
});
