import type { AccountRecord, CancelSignal, ConnectedAccount, UserId } from '@sc/api';

import type { JournalEntry } from '../ports';
import type { SyncParts } from './parts';
import { identityOf, PARENTS_FIRST, recordFor } from './records';

// Well under what a server takes in one batch; a whole account fits many times over.
const BATCH = 200;


/**
 * Sends the journal after the checkpoint as batches the server stores whole
 * or not at all, parents first. Each journaled entity goes once, as its row is
 * now. A batch the server refuses names the write that stopped it, and that
 * write is dealt with, then the rest sent again:
 *
 * - `limit` — a profile over the server's limit stays on this device only,
 *   with everything of it, until there is room;
 * - `deleted` — a write to a deleted profile or connection gives way, with
 *   everything of it: the delete arrives with the next read;
 * - `invalid` — left out, and said so, rather than holding every later
 *   change back for ever. Its identity goes into `refused`, so the reconcile
 *   after does not take it for lost and send it again on every run.
 *
 * The checkpoint moves past what was stored, and no further.
 */
export async function pushPending(parts: SyncParts, account: ConnectedAccount, refused: Set<string>, signal?: CancelSignal): Promise<void> {
  const { db } = parts;
  for (;;) {
    const state = await db.account.sync();
    const entries = await db.journal.entries(state.checkpoint, BATCH);
    const last = entries[entries.length - 1];
    if (!last) return;

    const heldBack = new Set(state.heldBack);
    let records = await recordsOf(parts, entries, heldBack);
    while (records.length > 0) {
      const outcome = await account.push(records, signal);
      if (outcome.kind === 'stored') break;
      const stopped = records[outcome.index];
      if (!stopped) break;
      if (outcome.reason === 'limit' && stopped.kind === 'profile') {
        heldBack.add(stopped.key as UserId);
        records = records.filter((record) => !ownedBy(record, stopped.key));
      } else if (outcome.reason === 'deleted') {
        records = records.filter((record) => record !== stopped && !childOf(record, stopped));
      } else {
        parts.log.warn('sync', 'The account refused a change, and it was left out', { kind: stopped.kind });
        refused.add(identityOf(stopped));
        records = records.filter((record) => record !== stopped);
      }
    }
    await db.unjournaled(async (tx) => {
      const current = await tx.account.sync();
      await tx.account.putSync({ ...current, checkpoint: Math.max(current.checkpoint, last.seq), heldBack: [...heldBack] });
    });
  }
}

/** Every entity the entries name, once, as it is now — parents first; nothing of a profile held back. */
async function recordsOf(parts: SyncParts, entries: readonly JournalEntry[], heldBack: ReadonlySet<string>): Promise<AccountRecord[]> {
  const latest = new Map<string, JournalEntry>();
  for (const entry of entries) latest.set(`${entry.entity}/${entry.entityId}`, entry);
  const records: AccountRecord[] = [];
  for (const entry of latest.values()) {
    const record = await recordFor(entry, parts);
    if (record && ![...heldBack].some((userId) => ownedBy(record, userId))) records.push(record);
  }
  const seen = new Set<string>();
  return records
    .filter((record) => {
      const identity = identityOf(record);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .sort((a, b) => PARENTS_FIRST.indexOf(a.kind) - PARENTS_FIRST.indexOf(b.kind));
}

/** Whether a record is a profile's or one of its own: its PIN, preferences, and values on connections. */
function ownedBy(record: Pick<AccountRecord, 'kind' | 'key'>, userId: string): boolean {
  const [first, second] = record.key.split('/');
  if (record.kind === 'profile' || record.kind === 'pin' || record.kind === 'preference') return first === userId;
  return record.kind === 'profileValues' && second === userId;
}

/** Whether a record hangs off a profile or a connection: goes when it goes. */
function childOf(record: Pick<AccountRecord, 'kind' | 'key'>, parent: Pick<AccountRecord, 'kind' | 'key'>): boolean {
  if (parent.kind === 'profile') return record !== parent && ownedBy(record, parent.key);
  return parent.kind === 'connection' && record.kind === 'profileValues' && record.key.split('/')[0] === parent.key;
}
