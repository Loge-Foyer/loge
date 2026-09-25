import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * After any local write: refresh device-level and profile-level entries. A
 * profile's sources depend on device state (installed plugins, shared
 * connections), so both prefixes go together.
 */
export function useRefreshLocalState(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['device'] }),
      client.invalidateQueries({ queryKey: ['user'] }),
    ]);
  }, [client]);
}
