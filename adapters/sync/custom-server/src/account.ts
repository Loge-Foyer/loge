import {
  type AccountInfo,
  type AccountRecord,
  type AccountStatus,
  type ConnectedAccount,
  type FieldValue,
  type PluginContext,
  type PluginTarget,
  type PushRefusal,
} from '@loge/api';

import { createClient } from './client';
import { statusError, unreadable } from './errors';
import { bodyOf, collectionOf, COLLECTIONS, recordOf } from './records';
import { hostOf, normalizeBaseUrl } from './url';

// Well under the server's 1,000 requests and 32 MiB a batch; the app sends fewer still.
const PER_PAGE = 500;
const SIGN_UPS = ['invite', 'open', 'closed'] as const;

const text = (value: FieldValue | undefined) => (typeof value === 'string' ? value : '');

/** Connecting does no network work: signing in waits for the first call. */
export function createAccount(target: PluginTarget, context: PluginContext): ConnectedAccount {
  const baseUrl = normalizeBaseUrl(text(target.fields.serverUrl));
  const username = text(target.fields.username).trim().normalize('NFC');
  const client = createClient({ baseUrl, username, context });
  const statusOf = (session: { readonly accountId: string; readonly username: string }): AccountStatus => ({
    accountId: session.accountId,
    accountName: `${session.username} on ${hostOf(baseUrl)}`,
  });
  const sha256 = (data: Uint8Array) => context.crypto.sha256(data);

  return {
    connectionId: target.connectionId,

    info: async (signal) => {
      const response = await client.open('GET', '/api/foyer/info', signal ? { signal } : {});
      if (response.status >= 400) throw statusError(response.status);
      const info = readInfo(client.json(response));
      if (!info) throw unreadable();
      return info;
    },

    status: async (signal) => statusOf(await client.live(signal)),

    createAccount: async (fields, { firstProfile }, signal) =>
      statusOf(await client.create({ invite: text(fields.invite).trim(), firstProfile }, signal)),

    verifyOwner: (proof, signal) => client.verify(proof.password ?? '', signal),

    pull: async (signal) => {
      // Every sync keeps the session another 30 days.
      await client.refresh(signal);
      const records: AccountRecord[] = [];
      for (const [kind, collection] of COLLECTIONS) {
        for (let page = 1; ; page += 1) {
          const response = await client.authorized('GET', `/api/collections/${collection}/records?page=${page}&perPage=${PER_PAGE}&sort=id&skipTotal=1`, signal ? { signal } : {});
          if (response.status >= 400) throw statusError(response.status);
          const items = (client.json(response) as { items?: unknown } | null)?.items;
          if (!Array.isArray(items)) throw unreadable();
          for (const item of items) {
            const record = typeof item === 'object' && item !== null ? recordOf(kind, item as Readonly<Record<string, unknown>>) : undefined;
            if (record) records.push(record);
          }
          // Sorted by id, a write between two pages can repeat a record, and never hide one.
          if (items.length < PER_PAGE) break;
        }
      }
      return { records };
    },

    push: async (records, signal) => {
      if (records.length === 0) return { kind: 'stored' };
      const { accountId } = await client.live(signal);
      const requests = await Promise.all(
        records.map(async (record) => ({
          method: 'PUT',
          url: `/api/collections/${collectionOf(record.kind)}/records`,
          body: await bodyOf(record, accountId, sha256),
        })),
      );
      const response = await client.authorized('POST', '/api/batch', { body: JSON.stringify({ requests }), ...(signal ? { signal } : {}) });
      if (response.status === 200) return { kind: 'stored' };
      if (response.status === 400) {
        const refusal = refusalOf(client.json(response));
        if (refusal) return { kind: 'refused', ...refusal };
      }
      // Its time up, or the batch API off: nothing was stored and nothing judged, so it goes again later.
      if (response.status === 400 || response.status === 403) throw statusError(503);
      throw statusError(response.status);
    },

    signOut: () => client.forget(),

    dispose: async () => {},
  };
}

function readInfo(value: unknown): AccountInfo | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { serverVersion, maxProfiles, signUp } = value as Readonly<Record<string, unknown>>;
  if (typeof serverVersion !== 'string' || typeof maxProfiles !== 'number' || !Number.isInteger(maxProfiles) || maxProfiles < 1) return undefined;
  if (!(SIGN_UPS as readonly unknown[]).includes(signUp)) return undefined;
  return { serverVersion, maxProfiles, signUp: signUp as AccountInfo['signUp'] };
}

/**
 * The write a refused batch names, and why: PocketBase puts the refused
 * request under `data.requests.{index}.response`, and the server's hooks name
 * their reason as a field error's code.
 */
function refusalOf(body: unknown): { readonly index: number; readonly reason: PushRefusal } | undefined {
  const requests = (body as { data?: { requests?: Readonly<Record<string, unknown>> } } | null)?.data?.requests;
  if (typeof requests !== 'object' || requests === null) return undefined;
  const [entry] = Object.entries(requests);
  if (!entry) return undefined;
  const index = Number(entry[0]);
  if (!Number.isInteger(index) || index < 0) return undefined;
  const fields = (entry[1] as { response?: { data?: Readonly<Record<string, { code?: unknown }>> } } | null)?.response?.data ?? {};
  const codes = Object.values(fields).map((field) => field?.code);
  const reason: PushRefusal = codes.includes('foyer_limit') ? 'limit' : codes.includes('foyer_deleted') ? 'deleted' : 'invalid';
  return { index, reason };
}
