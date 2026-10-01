import type { RemoteKey } from './use-remote-keys';

/** A browser is not a TV: no remote, and nothing to listen for. */
export function useRemoteKeys(_onKey: (key: RemoteKey) => void) {}
