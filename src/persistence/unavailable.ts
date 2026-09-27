import type { AppError } from '@sc/api';

import type { LocalDatabase } from '@/services/ports';

import { standaloneRepositories } from './standalone';

/** A database that cannot be used here, and says why on every call — which boot turns into its failure screen. */
export function unavailableDatabase(reason: AppError): LocalDatabase {
  const refuse = async (): Promise<never> => {
    throw reason;
  };
  return {
    ...standaloneRepositories(refuse, refuse),
    transaction: refuse,
    journal: { entries: refuse },
  };
}
