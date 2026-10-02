import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';

import { ServicesContext } from '@/hooks/services-context';
import type { Services } from '@/services';

import { createServices } from './services';

interface AppGraph {
  readonly services: Services;
  readonly queryClient: QueryClient;
}

let graph: AppGraph | undefined;

// Fast Refresh runs this module again after an edit anywhere below it. A new
// graph would open the database a second time — on iOS, on the same native
// connection — so in development the first graph stays; reload to pick up a
// change in a service.
const devHolder = globalThis as { __logeGraph?: AppGraph };

/**
 * Built once per JavaScript runtime, not per mount: the router may remount the
 * root layout — a deep link, the browser's back button — and that must never
 * mean a second service graph.
 */
function appGraph(): AppGraph {
  const existing = __DEV__ ? devHolder.__logeGraph : graph;
  if (existing) return existing;
  const { services, start } = createServices();
  const created: AppGraph = {
    services,
    queryClient: new QueryClient({
      defaultOptions: {
        // Everything cached is local state that changes only through this
        // app's own mutations, and each mutation invalidates what it touched.
        // Reading or writing it needs no network: never wait for "online".
        queries: { staleTime: Infinity, retry: false, networkMode: 'always' },
        mutations: { networkMode: 'always' },
      },
    }),
  };
  if (__DEV__) devHolder.__logeGraph = created;
  else graph = created;
  // A browser reports focus by itself; on a device, coming back to the app is the focus.
  if (process.env.EXPO_OS !== 'web') {
    focusManager.setEventListener((setFocused) => {
      const subscription = AppState.addEventListener('change', (state) => setFocused(state === 'active'));
      return () => subscription.remove();
    });
  }
  void start();
  return created;
}

export function ServicesProvider({ children }: { children: ReactNode }) {
  const { services, queryClient } = appGraph();
  return (
    <ServicesContext value={services}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ServicesContext>
  );
}
