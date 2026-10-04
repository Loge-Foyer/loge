import { connectionId } from '@loge/api';
import { describe, expect, it } from 'vitest';

import { fromRouteId, keyHref, routeId, titleHref, titleKeyHref } from '@/components/media/item-link';

// What expo-router does to a param: `resolveHref` encodes it once, then the
// path or query is decoded when it is parsed, and `useLocalSearchParams`
// decodes it again.
const throughTheRouter = (param: string, decodes: 1 | 2) => {
  let value = encodeURIComponent(param);
  for (let time = 0; time < decodes; time += 1) value = decodeURIComponent(value);
  return value;
};

const ids = [
  // A portal's own id holds a colon, and Stalker encodes each part of its ids.
  'show:s:18390%3A18390',
  'episode:s:18390%3A18390:1:3',
  'season:v:7%3A7:1',
  'vod:12345',
  'a/b/c',
  'tilde~in~it',
  '~25',
  '~7E%7E',
  '100%',
  'plain',
];

describe('an adapter id in a route', () => {
  it.each(ids)('comes back as %s, however many times the router decodes it', (id) => {
    expect(fromRouteId(throughTheRouter(routeId(id), 1))).toBe(id);
    expect(fromRouteId(throughTheRouter(routeId(id), 2))).toBe(id);
  });

  it('was changed by the second decode when it went in as it is', () => {
    expect(throughTheRouter('show:s:18390%3A18390', 2)).toBe('show:s:18390:18390');
  });

  it('leaves an id with nothing to escape as it is', () => {
    expect(routeId('vod:12345')).toBe('vod:12345');
  });

  it('carries the escaped id in an item link', () => {
    expect(keyHref({ connectionId: connectionId('c1'), externalId: 'show:s:1%3A1' })).toEqual({
      pathname: '/item/[connectionId]/[itemId]',
      params: { connectionId: 'c1', itemId: 'show:s:1~253A1' },
    });
  });
});

describe('a title’s page on Media', () => {
  const c1 = connectionId('c1');

  it('carries the escaped id, as an item link does', () => {
    expect(titleKeyHref({ connectionId: c1, externalId: 'show:s:1%3A1' })).toEqual({
      pathname: '/title/[connectionId]/[itemId]',
      params: { connectionId: 'c1', itemId: 'show:s:1~253A1' },
    });
  });

  it('opens a season as its show, with that season chosen', () => {
    expect(
      titleHref({
        type: 'season',
        key: { connectionId: c1, externalId: 'season:v:7%3A7:1' },
        title: 'Season 1',
        show: { connectionId: c1, externalId: 'show:v:7%3A7' },
        ratings: {},
        genres: [],
        images: {},
      }),
    ).toEqual({
      pathname: '/title/[connectionId]/[itemId]',
      params: { connectionId: 'c1', itemId: 'show:v:7~253A7', season: 'season:v:7~253A7:1' },
    });
  });

  it('opens anything else as itself', () => {
    expect(
      titleHref({ type: 'movie', key: { connectionId: c1, externalId: 'm1' }, title: 'Film', ratings: {}, genres: [], images: {} }),
    ).toEqual({ pathname: '/title/[connectionId]/[itemId]', params: { connectionId: 'c1', itemId: 'm1' } });
  });
});
