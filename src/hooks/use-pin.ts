import type { UserId } from '@sc/api';
import { useMutation } from '@tanstack/react-query';

import { useServices } from './services-context';
import { useRefreshLocalState } from './use-local-state';

export function usePinActions() {
  const { pins } = useServices();
  const refresh = useRefreshLocalState();

  return {
    create: useMutation({
      mutationFn: ({ userId, pin }: { userId: UserId; pin: string }) => pins.create(userId, pin),
      onSuccess: () => refresh(),
    }),
    change: useMutation({
      mutationFn: ({ userId, current, next }: { userId: UserId; current: string; next: string }) =>
        pins.change(userId, current, next),
      onSuccess: () => refresh(),
    }),
    remove: useMutation({
      mutationFn: ({ userId, current }: { userId: UserId; current: string }) =>
        pins.remove(userId, current),
      onSuccess: () => refresh(),
    }),
  };
}
