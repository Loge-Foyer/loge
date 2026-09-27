// The one place allowed to import every plugin: a conformance check over all of them.
import { MEDIA_CAPABILITY_MEMBERS, SYNC_PROVIDER_MEMBERS, validateManifest, type Plugin } from '@sc/api';
import { plugin as customServer } from '@sc/plugin-custom-server';
import { plugin as emby } from '@sc/plugin-emby';
import { plugin as google } from '@sc/plugin-google';
import { plugin as icloud } from '@sc/plugin-icloud';
import { plugin as invidious } from '@sc/plugin-invidious';
import { plugin as jellyfin } from '@sc/plugin-jellyfin';
import { plugin as mock } from '@sc/plugin-mock';
import { plugin as plex } from '@sc/plugin-plex';
import { plugin as webdav } from '@sc/plugin-webdav';
import { plugin as yattee } from '@sc/plugin-yattee';
import { describe, expect, it } from 'vitest';

import { fakeContext, fakeHttp, target } from './support/fake-http';

const plugins: readonly Plugin[] = [
  customServer,
  emby,
  google,
  icloud,
  invidious,
  jellyfin,
  mock,
  plex,
  webdav,
  yattee,
];

describe.each(plugins.map((plugin) => [plugin.manifest.id, plugin] as const))('%s', (_, plugin) => {
  it('has a sound manifest', () => {
    expect(validateManifest(plugin.manifest)).toEqual([]);
  });

  // A declared capability is a promise the app acts on. Every one of them
  // must be kept by a member of the connected provider.
  it('declares only media capabilities it implements', async () => {
    const declared = plugin.manifest.media?.capabilities ?? [];
    if (!plugin.media) {
      expect(declared).toEqual([]);
      return;
    }
    expect(plugin.manifest.media).toBeDefined();
    const provider = await plugin.media.connect(target({}), fakeContext({ http: fakeHttp({}).client }).context);
    for (const capability of declared) {
      for (const member of MEDIA_CAPABILITY_MEMBERS[capability] ?? []) {
        expect(typeof provider[member], `${capability} needs ${member}`).toBe('function');
      }
    }
    await provider.dispose();
  });

  // The app hands an account only what it declares, and drops nothing on its
  // side — a declared sync capability without an implementation loses data.
  it('declares only sync capabilities it implements', async () => {
    const declared = plugin.manifest.sync?.capabilities ?? [];
    if (!plugin.sync) {
      expect(declared).toEqual([]);
      return;
    }
    expect(plugin.manifest.sync).toBeDefined();
    const provider = await plugin.sync.connect(target({}), fakeContext({ http: fakeHttp({}).client }).context);
    for (const member of SYNC_PROVIDER_MEMBERS) {
      expect(typeof provider[member], `the sync role needs ${member}`).toBe('function');
    }
    await provider.dispose();
  });
});

it('gives every plugin a distinct id', () => {
  const ids = plugins.map((plugin) => plugin.manifest.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it('keeps media servers media-only: they are the master of their watch state', () => {
  for (const server of [jellyfin, emby, plex]) expect(server.manifest.sync).toBeUndefined();
});
