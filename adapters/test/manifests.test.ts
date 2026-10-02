// The one place allowed to import every plugin: a conformance check over all of them.
import {
  ACCOUNT_MEMBERS,
  BACKUP_MEMBERS,
  categoryOfPluginId,
  MEDIA_CAPABILITY_MEMBERS,
  METADATA_MEMBERS,
  validateManifest,
  type Plugin,
} from '@sc/api';
import { plugin as m3u } from '@sc/iptv-m3u';
import { plugin as mockIptv } from '@sc/iptv-mock';
import { plugin as stalker } from '@sc/iptv-stalker';
import { plugin as xtream } from '@sc/iptv-xtream';
import { plugin as tmdb } from '@sc/metadata-tmdb';
import { plugin as ksplayer } from '@sc/player-ksplayer';
import { plugin as mpv } from '@sc/player-mpv';
import { plugin as systemPlayer } from '@sc/player-system';
import { plugin as vlc } from '@sc/player-vlc';
import { plugin as emby } from '@sc/source-emby';
import { plugin as googleDrive } from '@sc/source-google-drive';
import { plugin as icloudDrive } from '@sc/source-icloud-drive';
import { plugin as invidious } from '@sc/source-invidious';
import { plugin as jellyfin } from '@sc/source-jellyfin';
import { plugin as mockSource } from '@sc/source-mock';
import { plugin as onedrive } from '@sc/source-onedrive';
import { plugin as plex } from '@sc/source-plex';
import { plugin as webdav } from '@sc/source-webdav';
import { plugin as yattee } from '@sc/source-yattee';
import { plugin as customServer } from '@sc/sync-custom-server';
import { plugin as googleDriveBackup } from '@sc/sync-google-drive';
import { plugin as icloudBackup } from '@sc/sync-icloud';
import { plugin as mockAccount } from '@sc/sync-mock';
import { plugin as mockBackup } from '@sc/sync-mock-backup';
import { plugin as onedriveBackup } from '@sc/sync-onedrive';
import { describe, expect, it } from 'vitest';

import { fakeContext, fakeHttp, target } from './support/fake-http';

const plugins: readonly Plugin[] = [
  jellyfin,
  emby,
  plex,
  webdav,
  yattee,
  invidious,
  icloudDrive,
  googleDrive,
  onedrive,
  mockSource,
  m3u,
  stalker,
  xtream,
  mockIptv,
  systemPlayer,
  ksplayer,
  mpv,
  vlc,
  customServer,
  icloudBackup,
  googleDriveBackup,
  onedriveBackup,
  mockAccount,
  mockBackup,
  tmdb,
];

const context = () => fakeContext({ http: fakeHttp({}).client }).context;

describe.each(plugins.map((plugin) => [plugin.manifest.id, plugin] as const))('%s', (_, plugin) => {
  const { manifest } = plugin;

  it('has a sound manifest, in the category its id names, running somewhere', () => {
    expect(validateManifest(manifest)).toEqual([]);
    expect(categoryOfPluginId(manifest.id)).toBe(manifest.category);
    expect(manifest.platforms.length).toBeGreaterThan(0);
  });

  // A declared capability is a promise the app acts on. Every one of them
  // must be kept by a member of the connected provider.
  it('declares only media capabilities it implements', async () => {
    const declared = manifest.media?.capabilities ?? [];
    if (!plugin.media) {
      expect(declared).toEqual([]);
      return;
    }
    expect(manifest.media).toBeDefined();
    const provider = await plugin.media.connect(target({}), context());
    for (const capability of declared) {
      for (const member of MEDIA_CAPABILITY_MEMBERS[capability] ?? []) {
        expect(typeof provider[member], `${capability} needs ${member}`).toBe('function');
      }
    }
    await provider.dispose();
  });

  // A profile is what the app picks a player by; an engine not written yet states none.
  it('states a player profile only for an engine it has', () => {
    if (!manifest.player) return;
    if (!plugin.player) expect(manifest.player.profiles).toEqual({});
    else expect(typeof plugin.player.create).toBe('function');
  });

  it('has every member its account role promises', async () => {
    if (!plugin.account) return;
    expect(manifest.account).toBeDefined();
    const account = await plugin.account.connect(target({}), context());
    for (const member of ACCOUNT_MEMBERS) expect(typeof account[member], `the account role needs ${member}`).toBe('function');
    if (manifest.account?.ownerProof) expect(typeof account.verifyOwner, 'ownerProof needs verifyOwner').toBe('function');
    if (manifest.account?.signUp) expect(typeof account.createAccount, 'signUp needs createAccount').toBe('function');
    await account.dispose();
  });

  it('has every member its backup role promises', async () => {
    if (!plugin.backup) return;
    expect(manifest.backup).toBeDefined();
    const backup = await plugin.backup.connect(target({}), context());
    for (const member of BACKUP_MEMBERS) expect(typeof backup[member], `the backup role needs ${member}`).toBe('function');
    await backup.dispose();
  });

  it('has every member its metadata role promises, and the role its block promises', async () => {
    expect(plugin.metadata === undefined).toBe(manifest.metadata === undefined);
    if (!plugin.metadata) return;
    const provider = await plugin.metadata.connect(target({}), context());
    for (const member of METADATA_MEMBERS) expect(typeof provider[member], `the metadata role needs ${member}`).toBe('function');
    await provider.dispose();
  });
});

it('gives every plugin a distinct id', () => {
  const ids = plugins.map((plugin) => plugin.manifest.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it('keeps media servers sources: they are the master of their watch state', () => {
  for (const server of [jellyfin, emby, plex]) {
    expect(server.manifest.category).toBe('sources');
    expect(server.manifest.account).toBeUndefined();
  }
});

it('keeps IPTV off the web, where portals send no CORS headers', () => {
  for (const provider of [m3u, stalker, xtream]) expect(provider.manifest.platforms).not.toContain('web');
});
