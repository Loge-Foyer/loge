import { isAccountRecord, recordId, type AccountRecord, type RecordKind } from '@sc/api';

/** The collection each kind lives in, parents first: the order a pull reads them in. */
export const COLLECTIONS: readonly (readonly [RecordKind, string])[] = [
  ['profile', 'profiles'],
  ['pin', 'profile_pins'],
  ['preference', 'preferences'],
  ['connection', 'connections'],
  ['profileValues', 'connection_profile_values'],
  ['subscription', 'subscriptions'],
  ['playlist', 'playlists'],
];

export const collectionOf = (kind: RecordKind): string => COLLECTIONS.find(([of]) => of === kind)?.[1] ?? kind;

export type Sha256 = (data: Uint8Array) => Promise<Uint8Array>;

/**
 * A record as the server stores it: its derived id, its account, its key, its
 * parents by their derived ids, and its data in snake_case. A tombstone is the
 * first four and its parents: the server clears the rest.
 */
export async function bodyOf(record: AccountRecord, accountId: string, sha256: Sha256): Promise<Record<string, unknown>> {
  const idOf = (kind: RecordKind, key: string) => recordId(sha256, accountId, kind, key);
  const body: Record<string, unknown> = {
    id: await idOf(record.kind, record.key),
    user: accountId,
    key: record.key,
    deleted: record.deleted,
  };
  const [first = '', second = ''] = record.key.split('/');
  if (record.kind === 'pin' || record.kind === 'preference') body.profile = await idOf('profile', first);
  if (record.kind === 'profileValues') {
    body.connection = await idOf('connection', first);
    body.profile = await idOf('profile', second);
  }
  // Their own ids are their keys, so the parents come from the data rather
  // than from the key — and a tombstone carries neither, which is why the
  // server keeps the relations it already stored.
  if (!record.deleted && record.kind === 'subscription') {
    body.profile = await idOf('profile', record.data.userId);
    body.connection = await idOf('connection', record.data.connectionId);
  }
  if (!record.deleted && record.kind === 'playlist') {
    body.profile = await idOf('profile', record.data.userId);
  }
  if (record.deleted) return body;

  switch (record.kind) {
    case 'profile':
      return { ...body, name: record.data.name };
    case 'pin':
      // The api's missing PIN is an empty one on the server.
      return { ...body, pin: record.data.pin ?? '' };
    case 'preference':
      return { ...body, name: record.data.name, value: record.data.value };
    case 'connection': {
      const { data } = record;
      return {
        ...body,
        plugin_id: data.pluginId,
        label: data.label,
        enabled: data.enabled,
        per_profile: data.perProfile,
        fields: data.fields,
        settings: data.settings,
        secret_keys: data.secretKeys,
        secrets: data.secrets,
      };
    }
    case 'profileValues': {
      const { data } = record;
      return { ...body, off: data.off, fields: data.fields, settings: data.settings, secret_keys: data.secretKeys, secrets: data.secrets };
    }
    case 'subscription': {
      const { data } = record;
      return {
        ...body,
        // The parents' keys as well as their derived ids: a read has only the
        // record's own key, which is a generated id and names nobody.
        profile_key: data.userId,
        connection_key: data.connectionId,
        external_id: data.externalId,
        title: data.title,
        added_at: data.addedAt,
      };
    }
    case 'playlist': {
      const { data } = record;
      return {
        ...body,
        profile_key: data.userId,
        title: data.title,
        description: data.description ?? '',
        items: data.items,
        // An empty object rather than null: PocketBase's JSON field has no
        // null, and "not a mirror of anything" is what absent means here.
        source: data.source ?? {},
        created_at: data.createdAt,
        updated_at: data.updatedAt,
      };
    }
  }
}

/**
 * A record read from the server, in the api's shape — or `undefined` when it
 * is not one the api allows. The app checks every record again: what a server
 * sends comes from whatever answers at the account's address.
 */
export function recordOf(kind: RecordKind, stored: Readonly<Record<string, unknown>>): AccountRecord | undefined {
  const { key, deleted } = stored;
  if (typeof key !== 'string' || typeof deleted !== 'boolean') return undefined;
  const candidate = deleted ? { kind, key, deleted: true } : { kind, key, deleted: false, data: dataOf(kind, key, stored) };
  return isAccountRecord(candidate) ? candidate : undefined;
}

function dataOf(kind: RecordKind, key: string, stored: Readonly<Record<string, unknown>>): unknown {
  const [first, second] = key.split('/');
  const values = {
    fields: stored.fields ?? {},
    settings: stored.settings ?? {},
    secretKeys: stored.secret_keys ?? [],
    secrets: stored.secrets ?? {},
  };
  switch (kind) {
    case 'profile':
      return { userId: key, name: stored.name };
    case 'pin':
      return { userId: key, pin: stored.pin === '' ? null : stored.pin };
    case 'preference':
      return { userId: first, name: stored.name, value: stored.value };
    case 'connection':
      return {
        connectionId: key,
        pluginId: stored.plugin_id,
        label: stored.label,
        enabled: stored.enabled,
        perProfile: stored.per_profile,
        ...values,
      };
    case 'profileValues':
      return { connectionId: first, userId: second, off: stored.off, ...values };
    case 'subscription':
      return {
        subscriptionId: key,
        userId: stored.profile_key,
        connectionId: stored.connection_key,
        externalId: stored.external_id,
        title: stored.title,
        addedAt: stored.added_at,
      };
    case 'playlist': {
      const source = stored.source;
      return {
        playlistId: key,
        userId: stored.profile_key,
        title: stored.title,
        ...(typeof stored.description === 'string' && stored.description !== '' ? { description: stored.description } : {}),
        items: stored.items ?? [],
        ...(isSource(source) ? { source } : {}),
        createdAt: stored.created_at,
        updatedAt: stored.updated_at,
      };
    }
  }
}

/** `{}` is how "not a mirror of anything" is stored, and is not a source. */
function isSource(value: unknown): value is { connectionId: string; externalId: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { connectionId?: unknown }).connectionId === 'string' &&
    typeof (value as { externalId?: unknown }).externalId === 'string'
  );
}
