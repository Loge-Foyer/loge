import type { ConnectionId, UserId } from '@loge/api';

import type { DeviceSettings, LocalDatabase } from './ports';

/**
 * The Live group a profile chose last on each provider, on this device, so
 * the Live tab opens there when the profile keeps no favourites on it. Device
 * state like the default profile: never journaled, never on your server,
 * never in a backup — and a profile's or a provider's goes with it
 * (`services/removal.ts`). `''` is All. ★ is never kept: favourites come
 * first by themselves.
 */
export interface LiveGroupService {
  /** `null` when this profile has chosen none there on this device. */
  last(userId: UserId, connectionId: ConnectionId): Promise<string | null>;
  remember(userId: UserId, connectionId: ConnectionId, group: string): Promise<void>;
}

/** An own key only, so no id is ever found on Object's prototype. */
const own = <T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  record !== undefined && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

export function createLiveGroupService(deps: { readonly db: LocalDatabase }): LiveGroupService {
  const { db } = deps;
  return {
    last: async (userId, connectionId) => own(own((await db.deviceSettings.get()).liveGroups, userId), connectionId) ?? null,
    remember: async (userId, connectionId, group) => {
      await db.transaction(async (tx) => {
        // Chosen as the profile or the provider went: nothing would remove it later.
        if (!(await tx.users.get(userId)) || !(await tx.connections.get(connectionId))) return;
        await tx.deviceSettings.update((current) => {
          const mine = own(current.liveGroups, userId);
          if (own(mine, connectionId) === group) return current;
          return { ...current, liveGroups: { ...current.liveGroups, [userId]: { ...mine, [connectionId]: group } } };
        });
      });
    },
  };
}

/** Without a profile's choices: it is gone from this device. */
export function forgetProfileGroups(settings: DeviceSettings, userId: UserId): DeviceSettings {
  if (own(settings.liveGroups, userId) === undefined) return settings;
  const { [userId]: _gone, ...rest } = settings.liveGroups ?? {};
  return withGroups(settings, rest);
}

/** Without a provider's, under every profile: it is gone from the account. */
export function forgetConnectionGroups(settings: DeviceSettings, connectionId: ConnectionId): DeviceSettings {
  const groups = settings.liveGroups ?? {};
  if (!Object.values(groups).some((mine) => own(mine, connectionId) !== undefined)) return settings;
  const next = Object.fromEntries(
    Object.entries(groups).flatMap(([userId, mine]) => {
      const { [connectionId]: _gone, ...rest } = mine;
      return Object.keys(rest).length > 0 ? [[userId, rest] as const] : [];
    }),
  );
  return withGroups(settings, next);
}

/** Nothing kept is no key at all, so its row goes. */
function withGroups(settings: DeviceSettings, groups: Readonly<Record<string, Readonly<Record<string, string>>>>): DeviceSettings {
  if (Object.keys(groups).length > 0) return { ...settings, liveGroups: groups };
  const { liveGroups: _gone, ...rest } = settings;
  return rest;
}

export type OpeningGroup = { readonly kind: 'favorites' } | { readonly kind: 'all' } | { readonly kind: 'group'; readonly id: string };

/**
 * Where Live opens on a provider when nothing was chosen there yet this time:
 * the favourites, when the profile keeps any there; else the group it chose
 * last, while the provider still has it; else All. `undefined` while what
 * decides it is still being read — so nothing is asked of the provider only
 * to be thrown away.
 */
export function openingGroup(facts: {
  readonly favorites: number | undefined;
  readonly last: string | null | undefined;
  readonly groups: readonly { readonly id: string }[] | undefined;
}): OpeningGroup | undefined {
  const { favorites, last, groups } = facts;
  if (favorites === undefined) return undefined;
  if (favorites > 0) return { kind: 'favorites' };
  if (last === undefined) return undefined;
  if (last === null || last === '') return { kind: 'all' };
  if (groups === undefined) return undefined;
  return groups.some((group) => group.id === last) ? { kind: 'group', id: last } : { kind: 'all' };
}
