import type { ContentKind, PluginRole } from '@sc/api';

export const CONTENT_KIND_LABELS: Readonly<Record<ContentKind, string>> = {
  movies: 'Movies',
  shows: 'Shows',
  anime: 'Anime',
  videos: 'Videos',
  files: 'Files',
};

export const ROLE_LABELS: Readonly<Record<PluginRole, string>> = {
  media: 'Media',
  sync: 'Sync',
};

/** "Movies, shows and anime". */
export function listKinds(kinds: readonly ContentKind[]): string {
  const words = kinds.map((kind) => CONTENT_KIND_LABELS[kind].toLowerCase());
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** "Jellyfin, Emby or Plex". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}
