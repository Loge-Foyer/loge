import {
  AppError,
  pluginId,
  type Channel,
  type ConnectedMediaProvider,
  type ConnectionId,
  type GlobalMediaKey,
  type Plugin,
  type Programme,
} from '@sc/api';
import { describe, expect, it } from 'vitest';

import { initialDraft, setValue } from '@/services/connection-draft';

import { ENGINES, type Engine } from './support/engines';
import { buildServices, movie } from './support/services';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 30, 18, 0);
const iso = (ms: number) => new Date(ms).toISOString();

/** A pretend portal: two groups, three channels, an hour-long programme on every channel every hour. */
function fakePortal(options: { keeps?: boolean } = {}) {
  let failing: AppError | undefined;
  const calls: string[] = [];
  const fail = () => {
    if (failing) throw failing;
  };
  const channel = (connectionId: ConnectionId, id: string, group: string): Channel => ({ key: { connectionId, externalId: id }, name: `Channel ${id}`, number: Number(id), groupIds: [group] });
  const plugin: Plugin = {
    manifest: {
      id: pluginId('iptv/fake'),
      category: 'iptv',
      platforms: ['ios', 'android', 'web'],
      displayName: 'Fake portal',
      description: 'A pretend portal.',
      media: { contentKinds: ['live', 'movies'], capabilities: ['browse', 'channels', 'epg', ...(options.keeps ? (['offlineMetadata'] as const) : [])] },
      connectionFields: [{ key: 'portalUrl', label: 'Portal', type: 'url', required: true }],
      settings: [],
    },
    media: {
      connect: async (target): Promise<ConnectedMediaProvider> => {
        const all = ['1', '2', '3'].map((id) => channel(target.connectionId, id, id === '3' ? 'films' : 'news'));
        return {
          connectionId: target.connectionId,
          check: async () => ({}),
          listChannelGroups: async () => {
            calls.push('groups');
            fail();
            return [{ id: 'news', name: 'News' }, { id: 'films', name: 'Films' }];
          },
          listChannels: async (query) => {
            calls.push(`channels ${query.groupId ?? '*'} ${query.cursor ?? '-'}`);
            fail();
            const list = all.filter((each) => !query.groupId || each.groupIds.includes(query.groupId));
            const offset = query.cursor ? Number(query.cursor) : 0;
            const page = list.slice(offset, offset + 2);
            return { channels: page, total: list.length, ...(offset + 2 < list.length ? { nextCursor: String(offset + 2) } : {}) };
          },
          getGuide: async (query) => {
            calls.push(`guide ${query.from}`);
            fail();
            const programmes: Programme[] = [];
            for (const key of query.channels) {
              for (let start = Math.floor(Date.parse(query.from) / HOUR) * HOUR; start < Date.parse(query.to); start += HOUR) {
                programmes.push({ channel: key, title: `${key.externalId} at ${new Date(start).getUTCHours()}`, startsAt: iso(start), endsAt: iso(start + HOUR) });
              }
            }
            return programmes;
          },
          listItems: async (query) => {
            fail();
            // The portal's own order: not sorted for the app.
            const films = ['Zulu', 'Alpha', 'Mike'].map((title, index) => movie(target.connectionId, `f${index}`, 2020, { title }));
            return query.kind === 'movies' ? { items: films } : { items: [] };
          },
          getItem: async (externalId) => ({ item: movie(target.connectionId, externalId, 2020), people: [], studios: [], externalIds: {} }),
          getChildren: async () => ({ items: [] }),
          dispose: async () => undefined,
        };
      },
    },
  };
  return {
    plugin,
    calls,
    fail: (error: AppError | undefined) => {
      failing = error;
    },
  };
}

describe.each(ENGINES)('live TV on %s', (engine: Engine) => {
  async function setUp(options: { keeps?: boolean } = {}) {
    const portal = fakePortal(options);
    const built = buildServices({ plugins: [portal.plugin], engine });
    const kids = await built.services.profiles.create('Kids');
    const draft = setValue(portal.plugin.manifest, initialDraft(portal.plugin.manifest, 0), kids.id, 'fields', 'portalUrl', 'http://portal.test/c/');
    const connection = await built.services.connections.create(portal.plugin.manifest.id, draft);
    return { ...built, portal, kids: kids.id, connectionId: connection.id };
  }
  const down = () => new AppError('PROVIDER_UNAVAILABLE', 'Down.', { retry: 'backoff' });

  it('lists groups and pages channels, in the source’s own order', async () => {
    const t = await setUp();
    expect((await t.services.media.channelGroups(t.kids, t.connectionId)).value.map((group) => group.name)).toEqual(['News', 'Films']);
    const first = await t.services.media.channels(t.kids, t.connectionId, { limit: 2 });
    expect(first.value.channels.map((channel) => channel.name)).toEqual(['Channel 1', 'Channel 2']);
    const second = await t.services.media.channels(t.kids, t.connectionId, { limit: 2, cursor: first.value.nextCursor ?? '' });
    expect(second.value.channels.map((channel) => channel.name)).toEqual(['Channel 3']);
    expect((await t.services.media.channels(t.kids, t.connectionId, { limit: 2, groupId: 'films' })).value.channels.map((channel) => channel.name)).toEqual(['Channel 3']);
  });

  it('keeps channels and the guide where the source allows it, and shows them — with when — while it is away', async () => {
    const t = await setUp({ keeps: true });
    const key: GlobalMediaKey = { connectionId: t.connectionId, externalId: '1' };
    await t.services.media.channels(t.kids, t.connectionId, { limit: 2 });
    await t.services.media.guide(t.kids, t.connectionId, [key], iso(T0), iso(T0 + 2 * HOUR));
    // Another window of the same day, merged with the first.
    await t.services.media.guide(t.kids, t.connectionId, [key], iso(T0 + 3 * HOUR), iso(T0 + 4 * HOUR));
    t.portal.fail(down());
    const channels = await t.services.media.channels(t.kids, t.connectionId, { limit: 2 });
    expect(channels.value.channels).toHaveLength(2);
    expect(channels.sourceError).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', savedAt: expect.any(Number) });
    const guide = await t.services.media.guide(t.kids, t.connectionId, [key], iso(T0), iso(T0 + 5 * HOUR));
    expect(guide.value.map((programme) => programme.title)).toEqual(['1 at 18', '1 at 19', '1 at 21']);
    expect(guide.sourceError?.savedAt).toBeDefined();
  });

  it('keeps nothing where the source does not allow it, and says the source is away', async () => {
    const t = await setUp({ keeps: false });
    await t.services.media.channels(t.kids, t.connectionId, { limit: 2 });
    t.portal.fail(down());
    await expect(t.services.media.channels(t.kids, t.connectionId, { limit: 2 })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('lists one source’s films in its own order, never merged or re-sorted', async () => {
    const t = await setUp();
    const page = await t.services.media.sourcePage(t.kids, t.connectionId, { kind: 'movies', sort: { by: 'addedAt', order: 'desc' }, limit: 20 });
    expect(page.items.map((item) => item.title)).toEqual(['Zulu', 'Alpha', 'Mike']);
  });
});
