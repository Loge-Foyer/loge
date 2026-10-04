import { effectiveCapabilities, type ConnectedMediaProvider, type FieldValues, type ItemPage, type MediaItem } from '@loge/api';
import { plugin } from '@loge/source-mock';
import { describe, expect, it } from 'vitest';

import { fakeContext, fakeHttp, target } from './support/fake-http';

async function connect(settings: FieldValues = {}, fields: FieldValues = {}) {
  const fake = fakeContext({ http: fakeHttp({}).client });
  const media = plugin.media;
  if (!media) throw new Error('The mock has no media role.');
  return { provider: await media.connect(target(fields, settings), fake.context), fake };
}

async function all(provider: ConnectedMediaProvider, kind: 'movies' | 'shows', limit = 7, genre?: string): Promise<MediaItem[]> {
  const listItems = provider.listItems;
  if (!listItems) throw new Error('listItems is missing');
  const items: MediaItem[] = [];
  let page: ItemPage | undefined;
  do {
    page = await listItems({
      kind,
      sort: { by: 'releaseDate', order: 'desc' },
      limit,
      ...(page?.nextCursor ? { cursor: page.nextCursor } : {}),
      ...(genre === undefined ? {} : { genre }),
    });
    items.push(...page.items);
  } while (page.nextCursor);
  return items;
}

describe('mock', () => {
  it('serves the same catalogue every time', async () => {
    const first = await all((await connect()).provider, 'movies');
    const second = await all((await connect()).provider, 'movies');
    expect(first).toEqual(second);
    expect(first).toHaveLength(40);
  });

  it('pages without duplicates or gaps, in release order', async () => {
    const items = await all((await connect()).provider, 'movies', 6);
    expect(new Set(items.map((item) => item.key.externalId)).size).toBe(items.length);
    const years = items.map((item) => item.year ?? 0);
    expect(years).toEqual(years.toSorted((a, b) => b - a));
  });

  it('narrows to one genre, paging as ever, and lists the genres it has', async () => {
    const { provider } = await connect();
    const genres = await provider.listGenres?.({ kind: 'movies' });
    expect(genres).toContain('Comedy');
    const comedies = await all(provider, 'movies', 4, 'comedy');
    expect(comedies.length).toBeGreaterThan(0);
    expect(comedies.every((item) => item.genres.includes('Comedy'))).toBe(true);
    expect(new Set(comedies.map((item) => item.key.externalId)).size).toBe(comedies.length);
  });

  it('lists only the genres of the libraries chosen', async () => {
    const kids = await all((await connect({ libraries: { mode: 'only', ids: ['kids'] } })).provider, 'movies');
    const { provider } = await connect({ libraries: { mode: 'only', ids: ['kids'] } });
    expect([...((await provider.listGenres?.({ kind: 'movies' })) ?? [])].sort()).toEqual([...new Set(kids.flatMap((item) => item.genres))].sort());
  });

  it('can be a source with no genres, with its switch off', () => {
    const off = effectiveCapabilities(plugin.manifest, { enabled: true, settings: { genres: false } });
    expect(off.media?.capabilities.has('genres')).toBe(false);
    expect(effectiveCapabilities(plugin.manifest, { enabled: true, settings: {} }).media?.capabilities.has('genres')).toBe(true);
  });

  it('honours the libraries setting', async () => {
    const onlyKids = await all((await connect({ libraries: { mode: 'only', ids: ['kids'] } })).provider, 'movies');
    const exceptKids = await all((await connect({ libraries: { mode: 'except', ids: ['kids'] } })).provider, 'movies');
    expect(onlyKids.length).toBeGreaterThan(0);
    expect(onlyKids.length + exceptKids.length).toBe(40);
  });

  it('has shows with seasons and episodes, and something to continue', async () => {
    const { provider } = await connect();
    const [show] = await all(provider, 'shows');
    if (!show || !provider.getChildren) throw new Error('no show');
    const [season] = (await provider.getChildren(show)).items;
    if (!season) throw new Error('no season');
    const episodes = (await provider.getChildren(season)).items;
    expect(episodes.length).toBeGreaterThanOrEqual(6);
    const resume = (await provider.getResume?.(10)) ?? [];
    expect(resume.length).toBeGreaterThan(0);
    expect(resume.every((item) => item.watch?.positionMs !== undefined)).toBe(true);
  });

  it('is slow through the injected clock, and flaky every third call', async () => {
    const slow = await connect({ latency: 'slow' });
    await slow.provider.check();
    expect(slow.fake.sleeps).toEqual([1_500]);
    const flaky = await connect({ latency: 'flaky' });
    await flaky.provider.check();
    await flaky.provider.check();
    await expect(flaky.provider.check()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retry: 'backoff' });
  });

  it('declines artwork, so it has nothing to resolve', async () => {
    const { provider } = await connect();
    expect(provider.resolveImage).toBeUndefined();
    expect(plugin.manifest.media?.capabilities).not.toContain('remoteImages');
  });
});
