import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ServicesContext } from '@/hooks/services-context';
import type { Services } from '@/services';

import { devSeedFrom, seedDevelopmentData } from './dev-seed';
import { createServices } from './services';

interface AppGraph {
  readonly services: Services;
  readonly queryClient: QueryClient;
}

let graph: AppGraph | undefined;

/**
 * Built once per JavaScript runtime, not per mount: the router may remount the
 * root layout — a deep link, the browser's back button — and that must never
 * mean a second service graph with its own, empty, state.
 */
function appGraph(): AppGraph {
  if (graph) return graph;
  const services = createServices();
  graph = {
    services,
    queryClient: new QueryClient({
      // Everything cached is local state that changes only through this app's
      // own mutations, and each mutation invalidates what it touched.
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    }),
  };
  const seed = __DEV__ ? devSeedFrom(process.env.EXPO_PUBLIC_DEV_SEED) : null;
  void (async () => {
    if (seed) await seedDevelopmentData(services, seed);
    await services.session.start();
  })();
  return graph;
}

export function ServicesProvider({ children }: { children: ReactNode }) {
  const { services, queryClient } = appGraph();
  return (
    <ServicesContext value={services}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ServicesContext>
  );
}
