import { AppError, TransportError, type ConnectedMetadataProvider, type Credentials, type IdentifyQuery } from '@sc/api';
import { plugin } from '@sc/metadata-tmdb';
import { describe, expect, it } from 'vitest';

import { fakeContext, fakeHttp, target, type RecordedRequest, type Route } from './support/fake-http';

const KEY = '0123456789abcdef0123456789abcdef';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ0ZXN0In0.c2lnbmF0dXJl';

async function connect(routes: Readonly<Record<string, Route>>, credentials: Credentials = { apiKey: KEY }) {
  const http = fakeHttp(routes);
  const role = plugin.metadata;
  if (!role) throw new Error('The TMDB plugin has no metadata role.');
  const provider = await role.connect(target({}), fakeContext({ http: http.client, credentials }).context);
  return { provider, http };
}

const film = (id: number, title: string, date: string, original = title) => ({ id, title, original_title: original, release_date: date });
const series = (id: number, name: string, date: string) => ({ id, name, original_name: name, first_air_date: date });

/** A search answering by the term asked for, and by year where one is asked. */
function searching(table: Readonly<Record<string, readonly { readonly release_date?: string; readonly first_air_date?: string }[]>>): Route {
  return (request: RecordedRequest) => {
    const year = request.query.year ?? request.query.first_air_date_year;
    const results = (table[request.query.query ?? ''] ?? []).filter(
      (result) => year === undefined || (result.release_date ?? result.first_air_date ?? '').startsWith(year),
    );
    return { status: 200, json: { page: 1, results, total_pages: 1, total_results: results.length } };
  };
}

function identify(provider: ConnectedMetadataProvider, query: IdentifyQuery) {
  return provider.identify(query);
}

describe('TMDB — the key', () => {
  it('sends an API key in the query, and nothing in a header', async () => {
    const { provider, http } = await connect({ 'GET /3/authentication': { status: 200, json: { success: true } } });
    await expect(provider.check()).resolves.toEqual({});
    const [request] = http.to('GET /3/authentication');
    expect(request?.query.api_key).toBe(KEY);
    expect(request?.headers.Authorization).toBeUndefined();
  });

  it('sends a Read Access Token as a bearer header, and never in the query', async () => {
    const { provider, http } = await connect({ 'GET /3/authentication': { status: 200, json: { success: true } } }, { apiKey: `  ${TOKEN}\n` });
    await provider.check();
    const [request] = http.to('GET /3/authentication');
    expect(request?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(request?.query.api_key).toBeUndefined();
  });

  it('takes a refused key as refused for good, and asks nothing more with it', async () => {
    const { provider, http } = await connect({ 'GET /3/authentication': { status: 401, json: { status_code: 7 } } });
    await expect(provider.check()).rejects.toMatchObject({ code: 'UNAUTHORIZED', retry: 'never' });
    await expect(identify(provider, { type: 'movie', title: 'The Matrix', year: 1999 })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(http.requests).toHaveLength(1);
  });

  it('asks nothing without a key', async () => {
    const { provider, http } = await connect({}, {});
    await expect(provider.check()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(http.requests).toHaveLength(0);
  });
});

describe('TMDB — what a film is', () => {
  it('finds a film by its title and year, without adult titles', async () => {
    const { provider, http } = await connect({
      'GET /3/search/movie': searching({ 'The Matrix': [film(603, 'The Matrix', '1999-03-30'), film(604, 'The Matrix Reloaded', '2003-05-15')] }),
    });
    await expect(identify(provider, { type: 'movie', title: 'The Matrix', year: 1999 })).resolves.toEqual({ tmdb: '603' });
    expect(http.to('GET /3/search/movie')[0]?.query).toMatchObject({ query: 'The Matrix', include_adult: 'false', year: '1999' });
  });

  it('asks by the original title first, which every copy shares', async () => {
    const { provider, http } = await connect({
      'GET /3/search/movie': searching({ Matrix: [film(603, 'The Matrix', '1999-03-30', 'Matrix')] }),
    });
    await expect(identify(provider, { type: 'movie', title: 'Matrix DE', originalTitle: 'Matrix', year: 1999 })).resolves.toEqual({ tmdb: '603' });
    expect(http.to('GET /3/search/movie').map((request) => request.query.query)).toEqual(['Matrix']);
  });

  it('matches without case, accents or punctuation', async () => {
    const { provider } = await connect({
      'GET /3/search/movie': searching({ 'amelie': [film(194, 'Amélie', '2001-04-25', 'Le Fabuleux Destin d’Amélie Poulain')] }),
    });
    await expect(identify(provider, { type: 'movie', title: 'amelie', year: 2001 })).resolves.toEqual({ tmdb: '194' });
  });

  it('takes a film a year either side, asking for any year when the year it was told finds none', async () => {
    const { provider, http } = await connect({ 'GET /3/search/movie': searching({ Parasite: [film(496243, 'Parasite', '2019-05-30')] }) });
    await expect(identify(provider, { type: 'movie', title: 'Parasite', year: 2020 })).resolves.toEqual({ tmdb: '496243' });
    expect(http.to('GET /3/search/movie').map((request) => request.query.year)).toEqual(['2020', undefined]);
  });

  it('refuses a film of another year, and never asks its names', async () => {
    const { provider, http } = await connect({ 'GET /3/search/movie': searching({ 'The Thing': [film(1091, 'The Thing', '1982-06-25')] }) });
    await expect(identify(provider, { type: 'movie', title: 'The Thing', year: 2011 })).resolves.toBeUndefined();
    expect(http.to('GET /3/movie/1091')).toHaveLength(0);
  });

  it('knows a film by its name in another language, once its translations say so', async () => {
    const { provider, http } = await connect({
      'GET /3/search/movie': searching({ 'Der Pate': [film(238, 'The Godfather', '1972-03-14')] }),
      'GET /3/movie/238': {
        status: 200,
        json: {
          id: 238,
          title: 'The Godfather',
          original_title: 'The Godfather',
          translations: { translations: [{ iso_639_1: 'de', data: { title: 'Der Pate' } }, { iso_639_1: 'fr', data: { title: 'Le Parrain' } }] },
          alternative_titles: { titles: [{ iso_3166_1: 'US', title: 'Mario Puzo’s The Godfather' }] },
        },
      },
    });
    await expect(identify(provider, { type: 'movie', title: 'Der Pate', year: 1972 })).resolves.toEqual({ tmdb: '238' });
    expect(http.to('GET /3/movie/238')[0]?.query.append_to_response).toBe('translations,alternative_titles');
  });

  it('takes nothing a search found by a name the film does not have', async () => {
    const { provider, http } = await connect({
      'GET /3/search/movie': searching({ 'Das Boot': [film(1, 'The Ship', '1981-09-17'), film(2, 'Boats', '1981-01-01'), film(3, 'Sea', '1981-02-02')] }),
      'GET /3/movie/1': { status: 200, json: { title: 'The Ship', translations: { translations: [] } } },
      'GET /3/movie/2': { status: 200, json: { title: 'Boats' } },
    });
    await expect(identify(provider, { type: 'movie', title: 'Das Boot', year: 1981 })).resolves.toBeUndefined();
    // The best two of the year, and no more.
    expect(http.requests.filter((request) => request.path.startsWith('/3/movie/')).map((request) => request.path)).toEqual(['/3/movie/1', '/3/movie/2']);
  });

  it('takes no film where several share a name and no year tells them apart', async () => {
    const dunes = { Dune: [film(438631, 'Dune', '2021-09-15'), film(841, 'Dune', '1984-12-14'), film(693134, 'Dune: Part Two', '2024-02-27')] };
    const { provider } = await connect({ 'GET /3/search/movie': searching(dunes) });
    await expect(identify(provider, { type: 'movie', title: 'Dune' })).resolves.toBeUndefined();
    await expect(identify(provider, { type: 'movie', title: 'Dune', year: 1984 })).resolves.toEqual({ tmdb: '841' });
  });

  it('asks nothing for a title with no letters it can compare', async () => {
    const { provider, http } = await connect({});
    await expect(identify(provider, { type: 'movie', title: 'Брат', year: 1997 })).resolves.toBeUndefined();
    expect(http.requests).toHaveLength(0);
  });
});

describe('TMDB — what a series is', () => {
  it('searches series by their first air date', async () => {
    const { provider, http } = await connect({ 'GET /3/search/tv': searching({ 'Breaking Bad': [series(1396, 'Breaking Bad', '2008-01-20')] }) });
    await expect(identify(provider, { type: 'show', title: 'Breaking Bad', year: 2008 })).resolves.toEqual({ tmdb: '1396' });
    expect(http.to('GET /3/search/tv')[0]?.query).toMatchObject({ query: 'Breaking Bad', first_air_date_year: '2008' });
  });

  it('reads a series’ names in other languages from its own fields', async () => {
    const { provider } = await connect({
      'GET /3/search/tv': searching({ 'Haus des Geldes': [series(71446, 'Money Heist', '2017-05-02')] }),
      'GET /3/tv/71446': {
        status: 200,
        json: {
          name: 'Money Heist',
          original_name: 'La casa de papel',
          translations: { translations: [{ iso_639_1: 'en', data: { name: 'Money Heist' } }] },
          alternative_titles: { results: [{ iso_3166_1: 'DE', title: 'Haus des Geldes' }] },
        },
      },
    });
    await expect(identify(provider, { type: 'show', title: 'Haus des Geldes', year: 2017 })).resolves.toEqual({ tmdb: '71446' });
  });
});

describe('TMDB — errors', () => {
  it('asks to wait when TMDB counts too many requests', async () => {
    const { provider } = await connect({ 'GET /3/search/movie': { status: 429, json: { status_code: 25 } } });
    const error = await identify(provider, { type: 'movie', title: 'Heat', year: 1995 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff', reason: 'too-many-attempts' });
  });

  it('says so when there is no network', async () => {
    const { provider } = await connect({ 'GET /3/search/movie': new TransportError('offline') });
    await expect(identify(provider, { type: 'movie', title: 'Heat', year: 1995 })).rejects.toMatchObject({ code: 'OFFLINE' });
  });

  it('reads an answer it cannot use as no result, never as a film', async () => {
    const { provider } = await connect({ 'GET /3/search/movie': { status: 200, json: { results: [{ id: 'x', title: 'Heat' }, null, { title: 'Heat' }] } } });
    await expect(identify(provider, { type: 'movie', title: 'Heat', year: 1995 })).resolves.toBeUndefined();
  });
});

describe('TMDB — a title gone meanwhile', () => {
  it('takes a film that vanished between the search and its names as unnamed', async () => {
    const { provider } = await connect({
      'GET /3/search/movie': searching({ 'Das Boot': [film(387, 'The Boat', '1981-09-17')] }),
      'GET /3/movie/387': { status: 404, json: { status_code: 34 } },
    });
    await expect(identify(provider, { type: 'movie', title: 'Das Boot', year: 1981 })).resolves.toBeUndefined();
  });
});
