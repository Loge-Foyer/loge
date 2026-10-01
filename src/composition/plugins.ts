import type { Plugin } from '@sc/api';
import type { PlayerPlugin } from '@sc/player-kit';
import { plugin as m3u } from '@sc/iptv-m3u';
import { plugin as mockIptv } from '@sc/iptv-mock';
import { plugin as stalker } from '@sc/iptv-stalker';
import { plugin as xtream } from '@sc/iptv-xtream';
import { plugin as mpv } from '@sc/player-mpv';
import { plugin as systemPlayer } from '@sc/player-system';
import { plugin as emby } from '@sc/source-emby';
import { plugin as invidious } from '@sc/source-invidious';
import { plugin as jellyfin } from '@sc/source-jellyfin';
import { plugin as mockSource } from '@sc/source-mock';
import { plugin as plex } from '@sc/source-plex';
import { plugin as webdav } from '@sc/source-webdav';
import { plugin as yattee } from '@sc/source-yattee';
import { plugin as customServer } from '@sc/sync-custom-server';
import { plugin as googleDriveBackup } from '@sc/sync-google-drive';
import { plugin as icloudBackup } from '@sc/sync-icloud';
import { plugin as mockAccount } from '@sc/sync-mock';
import { plugin as mockBackups } from '@sc/sync-mock-backup';
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
  // The three drives are not registered as *sources* for now: nothing reads
  // files from them yet, so listing them only offers a connection that cannot
  // do anything. Their adapters are still here, and so are the same three as
  // *backup targets*, which is a different job and does work.
  yattee,
  invidious,
  stalker,
  xtream,
  m3u,
  systemPlayer,
  // KSPlayer is not registered: it is a manifest with no engine, so listing it
  // only ever showed a player that could never be chosen. Its adapter stays,
  // and an import plus a line brings it back the day it has one.
  mpv,
  customServer,
  icloudBackup,
  googleDriveBackup,
  onedriveBackup,
  // Test doubles — offline, deliberately partial. Development builds only.
  ...(__DEV__ ? [mockSource, mockIptv, mockAccount, mockBackups] : []),
];

/** The players with an engine, and the view that draws it — what the player screen is handed. */
export const players: readonly PlayerPlugin[] = [systemPlayer, mpv];
