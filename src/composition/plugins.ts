import type { Plugin } from '@sc/api';
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

/**
 * Every plugin the app ships. The only file that names one: adding a plugin
 * is an import and an entry here.
 */
export const plugins: readonly Plugin[] = [
  jellyfin,
  emby,
  plex,
  webdav,
  icloud,
  google,
  yattee,
  invidious,
  customServer,
  // A test double — offline, deliberately partial. Development builds only.
  ...(__DEV__ ? [mock] : []),
];
