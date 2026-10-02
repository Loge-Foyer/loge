import {
  isAppError,
  titleKey,
  type CancelSignal,
  type ConnectedMetadataProvider,
  type ExternalIds,
  type IdentifyQuery,
  type PluginContext,
  type PluginTarget,
} from '@sc/api';

import { createClient } from './client';
import { readNames, readSearch, type Found } from './dto';

// How many of the results in the year are asked for their names in other
// languages, when none is called by the one asked for. TMDB ranks the best
// first; past the second, a name in another language is rarely the film.
const ASK_NAMES_OF = 2;

const PATH = { movie: 'movie', show: 'tv' } as const;

export function createProvider(target: PluginTarget, context: PluginContext): ConnectedMetadataProvider {
  const client = createClient(context);

  const search = async (query: IdentifyQuery, name: string, withYear: boolean, signal?: CancelSignal) =>
    readSearch(
      query.type,
      await client.get(
        `/search/${PATH[query.type]}`,
        {
          query: name,
          include_adult: false,
          // A film's `year` is any of its releases', a series' only its first air date's.
          ...(withYear && query.year !== undefined ? (query.type === 'movie' ? { year: query.year } : { first_air_date_year: query.year }) : {}),
        },
        signal,
      ),
    );

  const namesOf = async (type: IdentifyQuery['type'], id: number, signal?: CancelSignal): Promise<ReadonlySet<string>> => {
    try {
      const body = await client.get(`/${PATH[type]}/${id}`, { append_to_response: 'translations,alternative_titles' }, signal);
      return new Set(readNames(type, body).map(titleKey).filter((key) => key !== ''));
    } catch (error) {
      // Gone between the search and this: it has no names to match.
      if (isAppError(error) && error.code === 'NOT_FOUND') return new Set();
      throw error;
    }
  };

  /**
   * The one result `name` names. Within a year either side of the query's —
   * a film comes out a year apart in two countries — and called by the name
   * asked for; else, with no result called by it, the best of the year whose
   * names in other languages include it. Several films of one name and no
   * year to tell them apart are none.
   */
  const find = async (query: IdentifyQuery, name: string, keys: ReadonlySet<string>, signal?: CancelSignal) => {
    let found = within(await search(query, name, true, signal), query.year);
    if (found.length === 0 && query.year !== undefined) found = within(await search(query, name, false, signal), query.year);
    const named = found.filter((result) => result.names.some((candidate) => keys.has(titleKey(candidate))));
    if (named.length === 1 || (named.length > 1 && query.year !== undefined)) return named[0];
    if (named.length > 1) return undefined;
    const wanted = titleKey(name);
    for (const result of found.slice(0, ASK_NAMES_OF)) {
      if ((await namesOf(query.type, result.id, signal)).has(wanted)) return result;
    }
    return undefined;
  };

  return {
    connectionId: target.connectionId,
    check: async (signal) => {
      await client.get('/authentication', {}, signal);
      return {};
    },
    identify: async (query, signal): Promise<ExternalIds | undefined> => {
      // The title in its own language first: it is the one every copy shares.
      const byKey = new Map<string, string>();
      for (const name of [query.originalTitle, query.title]) {
        const key = name === undefined ? '' : titleKey(name);
        if (name !== undefined && key !== '' && !byKey.has(key)) byKey.set(key, name.trim());
      }
      const keys = new Set(byKey.keys());
      const names = [...byKey.values()];
      for (const name of names) {
        const result = await find(query, name, keys, signal);
        if (result) return { tmdb: String(result.id) };
      }
      return undefined;
    },
    dispose: async () => undefined,
  };
}

/** Results within a year either side of `year`; every one where it is not known. */
function within(results: readonly Found[], year: number | undefined): readonly Found[] {
  if (year === undefined) return results;
  return results.filter((result) => result.year !== undefined && Math.abs(result.year - year) <= 1);
}
