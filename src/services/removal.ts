import type { ConnectionId, CredentialsRef, UserId } from '@sc/api';

import type { Repositories } from './ports';
import { accountWide } from './scope';
import { sessionRef } from './sessions';

const isRef = (ref: CredentialsRef | undefined): ref is CredentialsRef => ref !== undefined;

/**
 * Removes a profile inside a transaction. The cascade takes everything it
 * owns; its secrets are not in the database, so they are queued: its own
 * sign-ins, its PIN, its sessions. `false` when there was no such profile.
 */
export async function removeProfileIn(tx: Repositories, id: UserId, options: { readonly allowLast: boolean }): Promise<boolean> {
  const all = await tx.users.list();
  const user = all.find((candidate) => candidate.id === id);
  if (!user) return false;
  // The last profile stays unless the account says otherwise: then the device starts again from nothing.
  if (!options.allowLast && all.length === 1) throw new Error('The last profile cannot be deleted.');
  const own = await tx.connections.valuesOfProfile(id);
  const connections = await tx.connections.list();
  await tx.users.delete(id);
  await tx.deviceSettings.update((current) => {
    if (current.defaultUserId !== id) return current;
    const { defaultUserId: _deleted, ...rest } = current;
    return rest;
  });
  await tx.staleSecrets.add([
    ...[...own.values()].map((values) => values.credentialsRef).filter(isRef),
    ...(user.pinCredentialRef ? [user.pinCredentialRef] : []),
    ...connections.map((connection) => sessionRef(connection.id, id)),
  ]);
  return true;
}

/**
 * Removes a connection inside a transaction. The cascade takes every
 * profile's values on it, what it answered and its sync state; its secrets
 * and every session it held are queued. `false` when there was no such
 * connection.
 */
export async function removeConnectionIn(tx: Repositories, id: ConnectionId): Promise<boolean> {
  const connection = await tx.connections.get(id);
  if (!connection) return false;
  const profiles = await tx.connections.profileValues(id);
  const users = await tx.users.list();
  await tx.connections.delete(id);
  await tx.staleSecrets.add([
    ...[connection.values.credentialsRef, ...[...profiles.values()].map((values) => values.credentialsRef)].filter(isRef),
    sessionRef(id, 'shared'),
    sessionRef(id, 'account'),
    ...users.map((user) => sessionRef(id, user.id)),
  ]);
  return true;
}

/**
 * Everything the account holds on this device goes, inside `tx`: its profiles
 * and its sources, with every secret of theirs queued. What a replace starts
 * from — a sign-in, or a backup imported. The device's own connections stay.
 */
export async function removeAccountRowsIn(tx: Repositories): Promise<void> {
  for (const user of await tx.users.list()) await removeProfileIn(tx, user.id, { allowLast: true });
  for (const connection of await tx.connections.list()) {
    if (accountWide(connection.pluginId)) await removeConnectionIn(tx, connection.id);
  }
}
