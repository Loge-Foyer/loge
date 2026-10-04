import type { AppUser, UserId } from '@loge/api';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { useServices } from '@/hooks/services-context';
import { useMaxProfiles } from '@/hooks/use-account';
import { useDefaultUserId, useProfileActions, useProfiles } from '@/hooks/use-profiles';
import { useGate } from '@/hooks/use-session';

export type PickerMode = 'boot' | 'switch';

/**
 * Who's watching, whatever draws it: the profiles, choosing one, adding one
 * by name, and the way to Settings → Profiles. A phone's grid and a TV's
 * column are two faces of this.
 */
export function useProfilePicker(mode: PickerMode) {
  const { session } = useServices();
  const gate = useGate();
  const activeId = gate.kind === 'ready' ? gate.userId : undefined;
  const { data: defaultUserId } = useDefaultUserId();
  const { data: profiles = [] } = useProfiles();
  const { create } = useProfileActions();
  const { data: maxProfiles } = useMaxProfiles();
  const full = maxProfiles !== undefined && profiles.length >= maxProfiles;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const choose = useMutation({
    mutationFn: async (userId: UserId) => {
      const outcome = await session.select(userId);
      // At launch the gate itself moves on; in-app, a PIN profile gets its unlock screen.
      if (mode === 'switch') {
        if (outcome === 'locked') router.push({ pathname: '/unlock/[userId]', params: { userId } });
        else router.dismissAll();
      }
    },
  });

  return {
    profiles,
    activeId,
    /** Where a remote's focus starts: the profile in use, else the one this device opens by default. */
    startsOn: activeId ?? defaultUserId ?? undefined,
    /** At the account's limit: no way to add another is offered. */
    full,
    choose: (userId: UserId) => choose.mutate(userId),
    choosing: choose.isPending,
    adding: adding && !full,
    openAdding: () => setAdding(true),
    closeAdding: () => {
      setAdding(false);
      setName('');
      create.reset();
    },
    name,
    setName,
    add: (onAdded?: (user: AppUser) => void) =>
      create.mutate(name, {
        onSuccess: (user) => {
          setName('');
          setAdding(false);
          onAdded?.(user);
        },
      }),
    addPending: create.isPending,
    addError: create.error?.message,
    /**
     * Settings → Profiles, or one profile's page there: the switcher goes
     * first, and the Settings tab opens on it. Only while the app runs — at
     * launch there is no tab to open.
     */
    edit: (userId?: UserId) => {
      router.dismissAll();
      if (userId) router.navigate({ pathname: '/settings/profiles/[userId]', params: { userId } });
      else router.navigate('/settings/profiles');
    },
    cancel: () => router.back(),
  };
}
