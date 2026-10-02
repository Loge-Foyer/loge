import { userId as toUserId, type AccountRecord, type CancelSignal, type ConnectedAccount } from '@sc/api';

import type { JournalEntry } from '../ports';
import type { SyncParts } from './parts';
import { identityOf, ownerByKey, PARENTS_FIRST, recordFor } from './records';

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

    const heldBack = new Set<string>(state.heldBack);
    let outgoing = await recordsOf(parts, entries, heldBack);
    while (outgoing.length > 0) {
      const outcome = await account.push(outgoing.map((each) => each.record), signal);
      if (outcome.kind === 'stored') break;
      const stopped = outgoing[outcome.index];
      if (!stopped) break;
      if (outcome.reason === 'limit' && stopped.record.kind === 'profile') {
        heldBack.add(stopped.record.key);
        outgoing = outgoing.filter((each) => each.owner !== stopped.record.key);
      } else if (outcome.reason === 'deleted') {
        outgoing = outgoing.filter((each) => each !== stopped && !childOf(each, stopped.record));
      } else {
        parts.log.warn('sync', 'The account refused a change, and it was left out', { kind: stopped.record.kind });
        refused.add(identityOf(stopped.record));
        outgoing = outgoing.filter((each) => each !== stopped);
      }
    }
    await db.unjournaled(async (tx) => {
      const current = await tx.account.sync();
      await tx.account.putSync({ ...current, checkpoint: Math.max(current.checkpoint, last.seq), heldBack: [...heldBack].map(toUserId) });
    });
  }
}

/**
 * A record to send, with the profile it belongs to and the connection it hangs
 * off. A subscription's, a favourite's and a playlist's key is a generated id
 * that names neither, and their tombstone has no body: their journal entry
 * says whose they are.
 */
interface Outgoing {
  readonly record: AccountRecord;
  readonly owner?: string;
  readonly connection?: string;
}

/** Every entity the entries name, once, as it is now — parents first; nothing of a profile held back. */
async function recordsOf(parts: SyncParts, entries: readonly JournalEntry[], heldBack: ReadonlySet<string>): Promise<Outgoing[]> {
  const latest = new Map<string, JournalEntry>();
  for (const entry of entries) latest.set(`${entry.entity}/${entry.entityId}`, entry);
  const outgoing: Outgoing[] = [];
  const seen = new Set<string>();
  for (const entry of latest.values()) {
    const record = await recordFor(entry, parts);
    if (!record) continue;
    const identity = identityOf(record);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const owner = ownerOf(record) ?? entry.userId;
    // Held back with its profile: the server has no room for it, and would refuse a child of a profile it lacks.
    if (owner !== undefined && heldBack.has(owner)) continue;
    const connection = connectionOf(record);
    outgoing.push({ record, ...(owner === undefined ? {} : { owner }), ...(connection === undefined ? {} : { connection }) });
  }
  return outgoing.sort((a, b) => PARENTS_FIRST.indexOf(a.record.kind) - PARENTS_FIRST.indexOf(b.record.kind));
}

/** Whose a record is, where its key or its body says. */
function ownerOf(record: AccountRecord): string | undefined {
  const byKey = ownerByKey(record.kind, record.key);
  if (byKey !== undefined || record.deleted) return byKey;
  return 'userId' in record.data ? record.data.userId : undefined;
}

/** The connection a record hangs off, where its key or its body says: a profile's values, a subscription, a favourite. */
function connectionOf(record: AccountRecord): string | undefined {
  if (record.kind === 'profileValues') return record.key.split('/')[0];
  if (record.deleted) return undefined;
  return record.kind === 'subscription' || record.kind === 'favoriteChannel' ? record.data.connectionId : undefined;
}

/** Whether a record hangs off a profile or a connection: goes when it goes. */
function childOf(record: Outgoing, parent: Pick<AccountRecord, 'kind' | 'key'>): boolean {
  if (parent.kind === 'profile') return record.owner === parent.key;
  return parent.kind === 'connection' && record.connection === parent.key;
}
