import type { CancelSignal, ConnectedUserStateSyncProvider, Connection, SyncCapability, SyncChange } from '@sc/api';

import type { JournalEntry } from '../ports';
import type { SyncParts } from './apply';
import type { VaultSource } from './sealed';
import { changeFor, keyOfEntry, type Outgoing } from './wire';

const BATCH = 100;

/**
 * Sends the journal after the checkpoint, in order, a batch at a time. The
 * checkpoint moves across the accepted prefix only, and every accepted change
 * waits to be seen coming back. An entry with nothing to send counts as sent
 * once everything before it is. `partial` when the account stored only part
 * of a batch: the rest goes again, verbatim, next time. With a vault,
 * connections go with their passwords, sealed.
 */
export async function pushPending(
  parts: SyncParts,
  provider: ConnectedUserStateSyncProvider,
  account: Connection,
  carried: ReadonlySet<SyncCapability>,
  options: { readonly signal?: CancelSignal; readonly vault?: VaultSource } = {},
): Promise<'done' | 'partial'> {
  const { signal, vault } = options;
  const out: Outgoing = {
    db: parts.db,
    credentials: parts.credentials,
    manifestOf: (pluginId) => parts.catalog.get(pluginId),
    account: account.id,
    carried,
    crypto: parts.crypto,
    ...(vault ? { vault } : {}),
    log: parts.log,
  };
  for (;;) {
    const state = await parts.db.syncState.get(account.id);
    if (!state) return 'done';
    const entries = await parts.db.journal.entries(state.checkpoint, BATCH);
    if (entries.length === 0) return 'done';

    const outgoing: { readonly entry: JournalEntry; readonly change: SyncChange }[] = [];
    for (const entry of entries) {
      const change = await changeFor(entry, out);
      if (change) outgoing.push({ entry, change });
    }
    let accepted = 0;
    if (outgoing.length > 0) {
      const answer = await provider.push(
        outgoing.map((item) => item.change),
        signal,
      );
      while (accepted < outgoing.length && answer.accepted[accepted] === outgoing[accepted]?.change.id) accepted += 1;
    }

    const refused = outgoing[accepted]?.entry;
    const sent = refused ? entries.slice(0, entries.indexOf(refused)) : entries;
    const checkpoint = sent[sent.length - 1]?.seq;
    const awaiting = Object.fromEntries(outgoing.slice(0, accepted).map((item) => [keyOfEntry(item.entry), item.change.id]));
    if (checkpoint !== undefined) {
      await parts.db.unjournaled(async (tx) => {
        const current = await tx.syncState.get(account.id);
        if (!current) return;
        await tx.syncState.put({
          ...current,
          checkpoint: Math.max(current.checkpoint, checkpoint),
          awaiting: { ...current.awaiting, ...awaiting },
        });
      });
    }
    if (refused) return 'partial';
  }
}
