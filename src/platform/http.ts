import { fetch } from 'expo/fetch';

import type { Logger, NetworkMonitor } from '@/services/ports';

import { createHttpClient, type FetchLike } from './http-client';

export function createPlatformHttpClient(network: NetworkMonitor, log: Logger) {
  return createHttpClient({ fetch: fetch as unknown as FetchLike, network, log, now: () => Date.now() });
}
