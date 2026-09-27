import { effectiveRoles, pluginId, type PluginManifest } from '@sc/api';
import { describe, expect, it } from 'vitest';

const manifest: PluginManifest = {
  id: pluginId('fixture'),
  displayName: 'Fixture',
  description: 'A plugin that exists only in tests.',
  media: { contentKinds: ['movies', 'shows'], capabilities: ['browse', 'search', 'watchStateWrite'] },
  sync: { capabilities: ['watchProgress', 'favorites'] },
  connectionFields: [],
  settings: [
    { key: 'reportProgress', label: 'Report', type: 'boolean', default: true, gates: ['media.watchStateWrite'] },
    { key: 'syncWatchProgress', label: 'Progress', type: 'boolean', default: false, gates: ['sync.watchProgress'] },
    { key: 'syncFavorites', label: 'Favourites', type: 'boolean', default: false, gates: ['sync.favorites'] },
  ],
};

describe('effectiveRoles', () => {
  it('treats a missing role as off', () => {
    expect(effectiveRoles(manifest, { roles: {}, settings: {} })).toEqual({ media: null, sync: null });
  });

  it('treats a role switched off as off', () => {
    const effective = effectiveRoles(manifest, { roles: { media: false, sync: false }, settings: {} });
    expect(effective).toEqual({ media: null, sync: null });
  });

  it('keeps ungated capabilities and passes content kinds through while media is on', () => {
    const { media } = effectiveRoles(manifest, { roles: { media: true }, settings: {} });
    expect(media?.contentKinds).toEqual(['movies', 'shows']);
    expect(media?.capabilities).toEqual(new Set(['browse', 'search', 'watchStateWrite']));
  });

  it('drops a capability whose toggle is switched off', () => {
    const { media } = effectiveRoles(manifest, {
      roles: { media: true },
      settings: { reportProgress: false },
    });
    expect(media?.capabilities).toEqual(new Set(['browse', 'search']));
  });

  it('falls back to a toggle’s default when nothing is stored', () => {
    const { sync } = effectiveRoles(manifest, { roles: { sync: true }, settings: {} });
    expect(sync?.capabilities).toEqual(new Set());
  });

  it('carries exactly what the user switched on', () => {
    const { sync } = effectiveRoles(manifest, {
      roles: { sync: true },
      settings: { syncWatchProgress: true },
    });
    expect(sync?.capabilities).toEqual(new Set(['watchProgress']));
  });

  it('ignores a stored value of the wrong type', () => {
    const { sync } = effectiveRoles(manifest, {
      roles: { sync: true },
      settings: { syncWatchProgress: 'yes' },
    });
    expect(sync?.capabilities).toEqual(new Set());
  });

  it('never puts an undeclared role in effect', () => {
    const { sync: _sync, ...mediaOnly } = manifest;
    const effective = effectiveRoles({ ...mediaOnly, settings: [] }, { roles: { media: true, sync: true }, settings: {} });
    expect(effective.sync).toBeNull();
  });
});
