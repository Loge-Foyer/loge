import type { FileStore } from '@/services/ports';

/**
 * A browser has nowhere to keep a film. expo-file-system's web build stubs its
 * download, and what a page could save goes to the user's Downloads folder,
 * outside anything this app can play from or count.
 *
 * So the web says so plainly rather than half-working: `available` is false,
 * every screen reads it, and nothing is ever queued.
 */
export function createFileStore(): FileStore {
  const refuse = () => {
    throw new Error('Downloads are not available in a browser.');
  };
  return {
    available: false,
    fetch: refuse,
    used: async () => 0,
    free: async () => 0,
    remove: async () => undefined,
    sweep: async () => undefined,
    uriOf: () => refuse(),
  };
}
