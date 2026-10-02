/**
 * TMDB's answers, read defensively: what comes back is whatever answered at
 * the address, so nothing is taken on trust and nothing of it leaves this
 * package but ids and names.
 */

/** One result of a search: its id, every name it answered with, and its year. */
export interface Found {
  readonly id: number;
  readonly names: readonly string[];
  readonly year?: number;
}

type Json = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** A film's or a series' title fields, which TMDB names differently for each. */
const TITLES = { movie: ['title', 'original_title'], show: ['name', 'original_name'] } as const;
const DATE = { movie: 'release_date', show: 'first_air_date' } as const;

export function readSearch(type: 'movie' | 'show', body: unknown): readonly Found[] {
  if (!isObject(body) || !Array.isArray(body.results)) return [];
  return body.results.flatMap((entry: unknown): Found[] => {
    if (!isObject(entry) || typeof entry.id !== 'number' || !Number.isInteger(entry.id)) return [];
    const names = TITLES[type].flatMap((field) => text(entry[field]) ?? []);
    const year = yearOf(entry[DATE[type]]);
    return [{ id: entry.id, names, ...(year === undefined ? {} : { year }) }];
  });
}

/**
 * Every name a film or a series has: its own, its translations' and its
 * alternative titles — from a details answer with `translations` and
 * `alternative_titles` appended.
 */
export function readNames(type: 'movie' | 'show', body: unknown): readonly string[] {
  if (!isObject(body)) return [];
  const names: string[] = TITLES[type].flatMap((field) => text(body[field]) ?? []);
  const translations = isObject(body.translations) && Array.isArray(body.translations.translations) ? body.translations.translations : [];
  for (const translation of translations) {
    if (!isObject(translation) || !isObject(translation.data)) continue;
    const name = text(translation.data[TITLES[type][0]]);
    if (name) names.push(name);
  }
  // A film's alternative titles are `titles`; a series' are `results`.
  const alternatives = isObject(body.alternative_titles) ? (body.alternative_titles.titles ?? body.alternative_titles.results) : undefined;
  for (const alternative of Array.isArray(alternatives) ? alternatives : []) {
    const name = isObject(alternative) ? text(alternative.title) : undefined;
    if (name) names.push(name);
  }
  return names;
}

function yearOf(value: unknown): number | undefined {
  const match = typeof value === 'string' ? /^(\d{4})-/.exec(value) : null;
  return match ? Number(match[1]) : undefined;
}
