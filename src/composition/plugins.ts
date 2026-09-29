import type { Plugin } from '@sc/api';
import { plugin as m3u } from '@sc/iptv-m3u';
import { plugin as stalker } from '@sc/iptv-stalker';
import { plugin as xtream } from '@sc/iptv-xtream';
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
import { plugin as onedriveBackup } from '@sc/sync-onedrive';

/**
 * Every plugin the app ships. The only file that names one: adding a plugin
 * is an import and an entry here. The catalogue sorts them by category, and
 * keeps only those that run on this platform.
 */
export const plugins: readonly Plugin[] = [
  jellyfin,
  emby,
  plex,
  webdav,
  icloudDrive,
  googleDrive,
  onedrive,
  yattee,
  invidious,
  stalker,
  xtream,
  m3u,
  systemPlayer,
  ksplayer,
  mpv,
  vlc,
  customServer,
  icloudBackup,
  googleDriveBackup,
  onedriveBackup,
  // Test doubles — offline, deliberately partial. Development builds only.
  ...(__DEV__ ? [mockSource, mockAccount] : []),
];
