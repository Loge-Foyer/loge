import type { Credentials, UserId } from '@loge/api';
import { useMutation, useQuery } from '@tanstack/react-query';

import type { PinScope } from '@/services/pins';
import { userKey } from '@/services/query-keys';

import { useServices } from './services-context';
import { useRefreshLocalState } from './use-local-state';

/** Where a profile's PIN comes from on this device, and whether it asks for one. */
export function usePinStatus(userId: UserId) {
  const { pins } = useServices();
  return useQuery({ queryKey: userKey(userId, 'pin'), queryFn: () => pins.status(userId) });
}

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
    /** All devices, or this device's own: with the PIN asked for now, when it asks for one. */
    setScope: useMutation({
      mutationFn: ({ userId, scope, current }: { userId: UserId; scope: PinScope; current?: string }) => pins.setScope(userId, scope, current),
      onSuccess: () => refresh(),
    }),
    /** Forgot PIN: the owner is asked — with `proof`, when the account asks for one — and only a yes clears it. */
    forgot: useMutation({
      mutationFn: ({ userId, proof }: { userId: UserId; proof?: Credentials }) => pins.forgot(userId, proof),
      onSuccess: () => refresh(),
    }),
  };
}
