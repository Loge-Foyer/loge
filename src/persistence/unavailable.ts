import type { AppError } from '@sc/api';

import type { SyncDatabase } from '@/services/ports';

import { standaloneRepositories } from './standalone';

/** A database that cannot be used here, and says why on every call — which boot turns into its failure screen. */
export function unavailableDatabase(reason: AppError): SyncDatabase {
  const refuse = async (): Promise<never> => {
    throw reason;
  };
  const standalone = standaloneRepositories(refuse, refuse);
  return {
    ...standalone,
    transaction: refuse,
    unjournaled: refuse,
    journal: { ...standalone.journal, subscribe: () => () => undefined },
  };
}
