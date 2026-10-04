import type { Plugin } from '@loge/api';
import type { PlayerPlugin } from '@loge/player-kit';
import { plugin as m3u } from '@loge/iptv-m3u';
import { plugin as mockIptv } from '@loge/iptv-mock';
import { plugin as stalker } from '@loge/iptv-stalker';
import { plugin as xtream } from '@loge/iptv-xtream';
import { plugin as tmdb } from '@loge/metadata-tmdb';
import { plugin as mpv } from '@loge/player-mpv';
import { plugin as systemPlayer } from '@loge/player-system';
import { plugin as vlc } from '@loge/player-vlc';
import { plugin as emby } from '@loge/source-emby';
import { plugin as invidious } from '@loge/source-invidious';
import { plugin as jellyfin } from '@loge/source-jellyfin';
import { plugin as mockSource } from '@loge/source-mock';
import { plugin as plex } from '@loge/source-plex';
import { plugin as webdav } from '@loge/source-webdav';
import { plugin as yattee } from '@loge/source-yattee';
import { plugin as customServer } from '@loge/sync-custom-server';
import { plugin as googleDriveBackup } from '@loge/sync-google-drive';
import { plugin as icloudBackup } from '@loge/sync-icloud';
import { plugin as mockAccount } from '@loge/sync-mock';
import { plugin as mockBackups } from '@loge/sync-mock-backup';
import { plugin as onedriveBackup } from '@loge/sync-onedrive';

import type { PlayerDefaults } from '@/services/players';

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
  vlc,
  customServer,
  icloudBackup,
  googleDriveBackup,
  onedriveBackup,
  tmdb,
  // Test doubles — offline, deliberately partial. Development builds only.
  ...(__DEV__ ? [mockSource, mockIptv, mockAccount, mockBackups] : []),
];

/** The players with an engine, and the view that draws it — what the player screen is handed. */
export const players: readonly PlayerPlugin[] = [systemPlayer, mpv, vlc];

/**
 * What a new device plays with until someone chooses: mpv first, and first on
 * Media; VLC next, and first on Live, where raw MPEG-TS channels are; the
 * built-in player on, and first nowhere. Where mpv and VLC do not run — a
 * browser — the built-in player is all there is, and plays everything.
 */
export const playerDefaults: PlayerDefaults = {
  order: [mpv.manifest.id, vlc.manifest.id, systemPlayer.manifest.id],
  tabs: { media: mpv.manifest.id, live: vlc.manifest.id },
};
