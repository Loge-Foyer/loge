import type { UserId } from '@sc/api';

// Every cache key starts with its owner. Profile separation is enforced twice:
// by ownership in storage, and by never letting one profile's cache entry
// answer another profile's question.

export const deviceKey = (...parts: readonly unknown[]) => ['device', ...parts] as const;

export const userKey = (userId: UserId, ...parts: readonly unknown[]) =>
  ['user', userId, ...parts] as const;
