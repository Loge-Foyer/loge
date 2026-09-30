import {
  isAccountRecord,
  userId as toUserId,
  connectionId as toConnectionId,
  type AccountRecord,
  type Credentials,
  type CredentialsRef,
  type RecordKind,
} from '@sc/api';

import type { JournalAnnouncement, JournalEntry, JournalEntity, LocalDatabase, SecureCredentialStore } from '../ports';
import { accountWide } from '../scope';

/** The record kind each journaled entity travels as. */
const KIND_OF: Readonly<Record<JournalEntity, RecordKind>> = {
  user: 'profile',
  userPin: 'pin',
  preferences: 'preference',
  connection: 'connection',
  connectionProfileValues: 'profileValues',
};

const ENTITY_OF: Readonly<Record<RecordKind, JournalEntity>> = {
  profile: 'user',
  pin: 'userPin',
  preference: 'preferences',
  connection: 'connection',
  profileValues: 'connectionProfileValues',
};

/** Parents first: a batch writes a profile before its PIN, a connection before its profiles' values. */
export const PARENTS_FIRST: readonly RecordKind[] = ['profile', 'pin', 'preference', 'connection', 'profileValues'];

/** A record's identity across the journal and the account: its kind and key. Journal ids are record keys already. */
export const identityOf = (record: Pick<AccountRecord, 'kind' | 'key'>): string => `${record.kind}/${record.key}`;

export const identityOfEntry = (entry: Pick<JournalEntry, 'entity' | 'entityId'>): string => `${KIND_OF[entry.entity]}/${entry.entityId}`;

/** A local row, announced as if just changed: how a sign-up uploads, and how a row a server lost goes back. */
export function announcementOf(kind: RecordKind, key: string): JournalAnnouncement {
  const [first] = key.split('/');
  const userId = kind === 'profile' || kind === 'pin' || kind === 'preference' ? first : kind === 'profileValues' ? key.split('/')[1] : undefined;
  return { ...(userId ? { userId: toUserId(userId) } : {}), entity: ENTITY_OF[kind], entityId: key, operation: 'upsert', localVersion: 0 };
}

/**
 * The record a journal entry sends: its entity as it is now — an entry points
 * at data and never copies it — or its tombstone. Nothing when there is
 * nothing to send: a sync plugin's connection, a row gone since (its delete
 * comes later in the journal), or a PIN or password this device cannot read,
 * never sent as "none". Read outside any transaction: the keychain is no part
 * of one.
 */
export async function recordFor(
  entry: Pick<JournalEntry, 'entity' | 'entityId' | 'operation'>,
  deps: { readonly db: LocalDatabase; readonly credentials: SecureCredentialStore },
): Promise<AccountRecord | undefined> {
  const kind = KIND_OF[entry.entity];
  const key = entry.entityId;
  const tombstone: AccountRecord = { kind, key, deleted: true } as AccountRecord;
  const secretsOf = async (ref: CredentialsRef | undefined, listed: readonly string[]): Promise<Credentials | undefined> => {
    if (!ref || listed.length === 0) return {};
    const saved = await deps.credentials.read(ref).catch(() => undefined);
    if (!saved) return undefined;
    const picked: Record<string, string> = {};
    for (const name of listed) if (saved[name] !== undefined) picked[name] = saved[name];
    return picked;
  };

  let record: AccountRecord | undefined;
  switch (entry.entity) {
    case 'user': {
      if (entry.operation === 'delete') return tombstone;
      const user = await deps.db.users.get(toUserId(key));
      record = user && { kind: 'profile', key, deleted: false, data: { userId: user.id, name: user.name } };
      break;
    }
    case 'userPin': {
      const user = await deps.db.users.get(toUserId(key));
      if (!user) return undefined;
      if (!user.pinCredentialRef) record = { kind: 'pin', key, deleted: false, data: { userId: user.id, pin: null } };
      else {
        const pin = (await deps.credentials.read(user.pinCredentialRef).catch(() => undefined))?.pin;
        if (pin === undefined) return undefined;
        record = { kind: 'pin', key, deleted: false, data: { userId: user.id, pin } };
      }
      break;
    }
    case 'preferences': {
      const [owner = '', name = ''] = key.split('/');
      if (entry.operation === 'delete') return tombstone;
      const value = ((await deps.db.preferences.get(toUserId(owner))) as Readonly<Record<string, unknown>>)[name];
      record = value === undefined ? tombstone : { kind: 'preference', key, deleted: false, data: { userId: toUserId(owner), name, value } };
      break;
    }
    case 'connection': {
      if (entry.operation === 'delete') return tombstone;
      const connection = await deps.db.connections.get(toConnectionId(key));
      if (!connection || !accountWide(connection.pluginId)) return undefined;
      const secretKeys = connection.values.secretKeys ?? [];
      const secrets = await secretsOf(connection.values.credentialsRef, secretKeys);
      record = {
        kind: 'connection',
        key,
        deleted: false,
        data: {
          connectionId: connection.id,
          pluginId: connection.pluginId,
          label: connection.label,
          enabled: connection.enabled,
          perProfile: connection.perProfile,
          fields: connection.values.fields,
          settings: connection.values.settings,
          secretKeys,
          // A password this device lacks is still listed: the server keeps the one another device saved.
          secrets: secrets ?? {},
        },
      };
      break;
    }
    case 'connectionProfileValues': {
      const [ofConnection = '', ofUser = ''] = key.split('/');
      if (entry.operation === 'delete') return tombstone;
      const connection = await deps.db.connections.get(toConnectionId(ofConnection));
      if (!connection || !accountWide(connection.pluginId)) return undefined;
      const values = (await deps.db.connections.profileValues(connection.id)).get(toUserId(ofUser));
      if (!values) return undefined;
      const secretKeys = values.secretKeys ?? [];
      const secrets = await secretsOf(values.credentialsRef, secretKeys);
      record = {
        kind: 'profileValues',
        key,
        deleted: false,
        data: {
          connectionId: connection.id,
          userId: toUserId(ofUser),
          off: values.off === true,
          fields: values.fields,
          settings: values.settings,
          secretKeys,
          secrets: secrets ?? {},
        },
      };
      break;
    }
  }
  return record && isAccountRecord(record) ? record : undefined;
}

/**
 * The whole account as records, each row as it is now, parents first — what a
 * backup holds. Read outside any transaction: the keychain is no part of one.
 * A PIN or password this device cannot read is left out, never written as
 * "none".
 */
export async function recordsOfAccount(deps: { readonly db: LocalDatabase; readonly credentials: SecureCredentialStore }): Promise<readonly AccountRecord[]> {
  const { db } = deps;
  const wanted: Pick<JournalEntry, 'entity' | 'entityId' | 'operation'>[] = [];
  const upsert = (entity: JournalEntity, entityId: string) => wanted.push({ entity, entityId, operation: 'upsert' });
  const users = await db.users.list();
  for (const user of users) upsert('user', user.id);
  for (const user of users) if (user.pinCredentialRef) upsert('userPin', user.id);
  for (const user of users) {
    for (const name of Object.keys(await db.preferences.get(user.id))) upsert('preferences', `${user.id}/${name}`);
  }
  const connections = (await db.connections.list()).filter((connection) => accountWide(connection.pluginId));
  for (const connection of connections) upsert('connection', connection.id);
  for (const connection of connections) {
    for (const userId of (await db.connections.profileValues(connection.id)).keys()) upsert('connectionProfileValues', `${connection.id}/${userId}`);
  }
  const records: AccountRecord[] = [];
  for (const entry of wanted) {
    const record = await recordFor(entry, deps);
    if (record) records.push(record);
  }
  return records;
}
