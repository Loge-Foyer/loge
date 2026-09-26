import type { UserId } from '@sc/api';

// Every cache key starts with its owner. Profile separation is enforced twice:
// by ownership in storage, and by never letting one profile's cache entry
// answer another profile's question.

export const deviceKey = (...parts: readonly unknown[]) => ['device', ...parts] as const;

export const userKey = (userId: UserId, ...parts: readonly unknown[]) =>
  ['user', userId, ...parts] as const;

/**
 * What a source answered, for one profile. Kept apart from local state so a
 * local edit — renaming a profile, moving a row — never refetches every server.
 */
export const remoteKey = (userId: UserId, ...parts: readonly unknown[]) => userKey(userId, 'remote', ...parts);

export function isRemoteKey(key: readonly unknown[]): boolean {
  return key[0] === 'user' && key[2] === 'remote';
}
