import { CATEGORY_SCOPE, categoryOfPluginId } from '@sc/api';

/**
 * Whether a plugin's connections travel with the account — a source's and an
 * IPTV plugin's — and so are journaled. A sync plugin's stay on the device.
 * An id that names no category is left alone rather than guessed at.
 */
export function accountWide(pluginId: string): boolean {
  const category = categoryOfPluginId(pluginId);
  return category !== undefined && CATEGORY_SCOPE[category] === 'account';
}
