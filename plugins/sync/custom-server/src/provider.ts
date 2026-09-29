import type { ConnectedUserStateSyncProvider, FieldValue, PluginContext, PluginTarget, SyncChange } from '@sc/api';

import { createClient } from './client';
import { statusError, unreadable } from './errors';
import { hostOf, normalizeBaseUrl } from './url';
import { readAccepted, readPage, readStatus } from './wire';

// Well under the server's 8 MiB body limit and its 1,000 changes a request.
const MAX_REQUEST_CHARS = 4 * 1024 * 1024;
const MAX_REQUEST_CHANGES = 1_000;

const text = (value: FieldValue | undefined) => (typeof value === 'string' ? value : '');

/** Connecting does no network work: signing in waits for the first call. */
export function createSyncProvider(target: PluginTarget, context: PluginContext): ConnectedUserStateSyncProvider {
  const baseUrl = normalizeBaseUrl(text(target.fields.serverUrl));
  // As the server compares it: two ways of typing one name are one account.
  const username = text(target.fields.username).trim().normalize('NFC').toLowerCase();
  const client = createClient({ baseUrl, username, context });
  const accountName = (name: string) => `${name} on ${hostOf(baseUrl)}`;

  return {
    connectionId: target.connectionId,

    getStatus: async (signal) => {
      const response = await client.authorized('GET', '/v1/status', signal ? { signal } : {});
      if (response.status >= 400) throw statusError(response.status);
      const name = readStatus(client.json(response));
      if (name === undefined) throw unreadable();
      return { accountName: accountName(name) };
    },

    pull: async (cursor, signal) => {
      const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
      const response = await client.authorized('GET', `/v1/sync/pull${query}`, signal ? { signal } : {});
      if (response.status >= 400) throw statusError(response.status);
      const page = readPage(client.json(response));
      if (!page) throw unreadable();
      return page;
    },

    // The accepted prefix runs across requests: one that stores less than it was sent ends the push.
    push: async (changes, signal) => {
      const accepted: string[] = [];
      for (const batch of batchesOf(changes)) {
        try {
          const response = await client.authorized('POST', '/v1/sync/push', {
            body: `{"changes":[${batch.bodies.join(',')}]}`,
            ...(signal ? { signal } : {}),
          });
          if (response.status >= 400) throw statusError(response.status);
          const answer = readAccepted(client.json(response));
          if (!answer) throw unreadable();
          let stored = 0;
          while (stored < batch.ids.length && answer[stored] === batch.ids[stored]) stored += 1;
          accepted.push(...batch.ids.slice(0, stored));
          if (stored < batch.ids.length) break;
        } catch (error) {
          // What earlier requests stored is stored: said so, rather than sent again.
          if (accepted.length > 0) break;
          throw error;
        }
      }
      return { accepted };
    },

    verifyOwner: (proof, signal) => client.verify(proof.password ?? '', signal),

    vaultKey: async (signal) => (await client.live(signal)).vaultKey,

    createAccount: async (fields, signal) => {
      await client.create(text(fields.invite).trim(), signal);
      return { accountName: accountName(username) };
    },

    signOut: (signal) => client.signOut(signal),

    dispose: async () => {},
  };
}

function batchesOf(changes: readonly SyncChange[]): readonly { readonly ids: readonly string[]; readonly bodies: readonly string[] }[] {
  const batches: { ids: string[]; bodies: string[]; chars: number }[] = [];
  for (const change of changes) {
    const body = JSON.stringify(change);
    const last = batches[batches.length - 1];
    if (last && last.ids.length < MAX_REQUEST_CHANGES && last.chars + body.length + 1 <= MAX_REQUEST_CHARS) {
      last.ids.push(change.id);
      last.bodies.push(body);
      last.chars += body.length + 1;
    } else {
      batches.push({ ids: [change.id], bodies: [body], chars: body.length });
    }
  }
  return batches;
}
