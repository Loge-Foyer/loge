import { encodeHex, encodeUtf8 } from '@sc/api';

import type { Logger, SyncDatabase } from './ports';
import { sessionRef } from './sessions';

/** What the launch found: a device seen for the first time, the same one, or one restored from another's backup. */
export type DeviceCheck = 'first' | 'same' | 'restored';

/**
 * A phone restored from its OS backup keeps its database, but not its
 * device-bound keychain — and so not its device key. Its journal is then
 * another phone's, and stale: pushed, it would put back what that phone had
 * changed long before. So the database keeps a fingerprint of the key — never
 * the key, which must not travel — and when it no longer matches, the pending
 * journal goes, and the account's session with it. The next run reads the
 * account and takes the server's version of everything; a row the server
 * never had is sent again, as for a server that lost it.
 */
export async function checkRestoredDevice(deps: {
  readonly db: SyncDatabase;
  readonly deviceKey: () => Promise<string>;
  readonly sha256: (data: Uint8Array) => Promise<Uint8Array>;
  readonly log: Logger;
}): Promise<DeviceCheck> {
  const print = encodeHex(await deps.sha256(encodeUtf8(`sc/device-key\n${await deps.deviceKey()}`))).slice(0, 32);
  const known = (await deps.db.deviceSettings.get()).deviceKeyPrint;
  if (known === print) return 'same';
  await deps.db.unjournaled(async (tx) => {
    await tx.deviceSettings.update((current) => ({ ...current, deviceKeyPrint: print }));
    if (known === undefined) return;
    await tx.journal.prune(await tx.journal.head());
    const account = await tx.account.get();
    if (account?.kind === 'server') await tx.staleSecrets.add([sessionRef(account.connectionId, 'account')]);
  });
  if (known === undefined) return 'first';
  deps.log.warn('sync', 'This device was restored from another one’s backup: the changes it had not sent were dropped');
  return 'restored';
}
