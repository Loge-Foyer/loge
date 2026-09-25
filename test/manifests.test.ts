// The one place allowed to import every plugin: a conformance check over all of them.
import { validateManifest, type Plugin } from '@sc/api';
import { plugin as customServer } from '@sc/plugin-custom-server';
import { plugin as emby } from '@sc/plugin-emby';
import { plugin as google } from '@sc/plugin-google';
import { plugin as icloud } from '@sc/plugin-icloud';
import { plugin as invidious } from '@sc/plugin-invidious';
import { plugin as jellyfin } from '@sc/plugin-jellyfin';
import { plugin as local } from '@sc/plugin-local';
import { plugin as mock } from '@sc/plugin-mock';
import { plugin as plex } from '@sc/plugin-plex';
import { plugin as webdav } from '@sc/plugin-webdav';
import { plugin as yattee } from '@sc/plugin-yattee';
import { describe, expect, it } from 'vitest';

const plugins: readonly Plugin[] = [
  customServer,
  emby,
  google,
  icloud,
  invidious,
  jellyfin,
  local,
  mock,
  plex,
  webdav,
  yattee,
];

describe.each(plugins.map((plugin) => [plugin.manifest.id, plugin] as const))('%s', (_, plugin) => {
  it('has a sound manifest', () => {
    expect(validateManifest(plugin.manifest)).toEqual([]);
  });

  // No role has an implementation yet, so declaring a capability would be a
  // promise nothing keeps. The mock is the test double and is exempt.
  it.skipIf(plugin === mock)('declares no capability ahead of its implementation', () => {
    expect(plugin.manifest.media?.capabilities ?? []).toEqual([]);
    expect(plugin.manifest.sync?.capabilities ?? []).toEqual([]);
  });
});

it('gives every plugin a distinct id', () => {
  const ids = plugins.map((plugin) => plugin.manifest.id);
  expect(new Set(ids).size).toBe(ids.length);
});
