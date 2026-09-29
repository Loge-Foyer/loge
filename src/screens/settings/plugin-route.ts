import { categoryOfPluginId, PLUGIN_CATEGORIES, qualifiedPluginId, type PluginCategory, type PluginId } from '@sc/api';

const NAME = /^[a-z][a-z0-9-]*$/;

/** The category a route names, if it names one. */
export function categoryParam(value: string | undefined): PluginCategory | undefined {
  return PLUGIN_CATEGORIES.find((category) => category === value);
}

/**
 * The plugin a `[category]/[name]` route names. The id's two parts are the two
 * segments, so an id is never URL-encoded.
 */
export function pluginParam(category: string | undefined, name: string | undefined): PluginId | undefined {
  const known = categoryParam(category);
  return known && name !== undefined && NAME.test(name) ? qualifiedPluginId(known, name) : undefined;
}

/** Where a category's list is. */
export function categoryHref(category: PluginCategory) {
  return { pathname: '/settings/plugins/[category]', params: { category } } as const;
}

/** Where a plugin's page is. An id that names no category leads to "not part of this app". */
export function pluginHref(id: PluginId) {
  const category = categoryOfPluginId(id);
  const name = category ? id.slice(category.length + 1) : id;
  return { pathname: '/settings/plugins/[category]/[name]', params: { category: category ?? 'sources', name } } as const;
}

/** Where a new connection to a plugin is made. */
export function newConnectionHref(id: PluginId) {
  const { params } = pluginHref(id);
  return { pathname: '/settings/plugins/[category]/[name]/new', params } as const;
}
