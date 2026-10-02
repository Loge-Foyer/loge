import type { Channel, ConnectionId, GlobalMediaKey, MediaItem } from '@sc/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { userKey } from '@/services/query-keys';

import { useServices } from './services-context';
import { useActiveUserId } from './use-session';

const LISTS = 'lists';

/** The channels this profile follows. */
export function useSubscriptions() {
  const userId = useActiveUserId();
  const { lists } = useServices();
  return useQuery({ queryKey: userKey(userId, LISTS, 'subscriptions'), queryFn: () => lists.subscriptions(userId) });
}

/** Whether this profile follows one channel — what the button reads. */
export function useFollows(connectionId: ConnectionId | undefined, externalId: string | undefined) {
  const userId = useActiveUserId();
  const { lists } = useServices();
  return useQuery({
    queryKey: userKey(userId, LISTS, 'follows', connectionId, externalId),
    queryFn: () => (connectionId && externalId ? lists.follows(userId, connectionId, externalId) : null),
    enabled: connectionId !== undefined && externalId !== undefined,
  });
}

/** A connection's favourite channels, for the ★ before its groups. */
export function useFavoriteChannels(connectionId: ConnectionId | undefined) {
  const userId = useActiveUserId();
  const { lists } = useServices();
  return useQuery({
    queryKey: userKey(userId, LISTS, 'favorite-channels', connectionId),
    queryFn: () => (connectionId ? lists.favoriteChannels(userId, connectionId) : []),
    enabled: connectionId !== undefined,
  });
}

export function usePlaylists() {
  const userId = useActiveUserId();
  const { lists } = useServices();
  return useQuery({ queryKey: userKey(userId, LISTS, 'playlists'), queryFn: () => lists.playlists(userId) });
}

export function usePlaylist(id: string | undefined) {
  const userId = useActiveUserId();
  const { lists } = useServices();
  return useQuery({
    queryKey: userKey(userId, LISTS, 'playlist', id),
    queryFn: () => (id ? lists.playlist(id) : null),
    enabled: id !== undefined,
  });
}

export function useListActions() {
  const userId = useActiveUserId();
  const { lists } = useServices();
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: userKey(userId, LISTS) });
  return {
    follow: useMutation({ mutationFn: (channel: MediaItem) => lists.follow(userId, channel), onSuccess: refresh }),
    unfollow: useMutation({ mutationFn: (id: string) => lists.unfollow(userId, id), onSuccess: refresh }),
    favorite: useMutation({ mutationFn: (channel: Channel) => lists.favorite(userId, channel), onSuccess: refresh }),
    unfavorite: useMutation({ mutationFn: (id: string) => lists.unfavorite(userId, id), onSuccess: refresh }),
    create: useMutation({ mutationFn: (title: string) => lists.create(userId, title), onSuccess: refresh }),
    rename: useMutation({ mutationFn: ({ id, title }: { id: string; title: string }) => lists.rename(id, title), onSuccess: refresh }),
    add: useMutation({ mutationFn: ({ id, key }: { id: string; key: GlobalMediaKey }) => lists.add(id, key), onSuccess: refresh }),
    removeItem: useMutation({
      mutationFn: ({ id, key }: { id: string; key: GlobalMediaKey }) => lists.removeItem(id, key),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => lists.remove(id), onSuccess: refresh }),
  };
}
