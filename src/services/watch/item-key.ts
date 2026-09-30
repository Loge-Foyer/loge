import type { GlobalMediaKey } from '@sc/api';

/** One item of one connection, as a string: what the outbox's pending set holds. */
export const itemKeyOf = (key: GlobalMediaKey): string => `${key.connectionId}/${key.externalId}`;
