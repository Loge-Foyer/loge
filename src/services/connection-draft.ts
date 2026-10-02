import {
  missingPerProfile,
  perProfileKeys,
  type FieldValue,
  type FieldValues,
  type PerProfile,
  type PluginManifest,
  type UserId,
} from '@loge/api';

import type {
  ConnectionDraft,
  ConnectionEditState,
  ProfileDraft,
  SavedSecrets,
  SecretChange,
  SecretScope,
  ValuesDraft,
} from './connections';
import { defaultValues, secretPresent } from './field-values';

// Pure helpers for editing a connection draft: which scope a value lives in,
// switching modes, and what each profile will have once saved.

export type ValueList = 'fields' | 'settings';

const EMPTY: ValuesDraft = { fields: {}, settings: {}, secrets: {} };

export function initialDraft(manifest: PluginManifest, existing: number): ConnectionDraft {
  return {
    label: existing === 0 ? manifest.displayName : `${manifest.displayName} ${existing + 1}`,
    enabled: true,
    perProfile: 'none',
    shared: { fields: defaultValues(manifest.connectionFields), settings: defaultValues(manifest.settings), secrets: {} },
    profiles: {},
  };
}

/** Defaults first, so a field or setting the plugin added since shows its default. */
export function draftOf(manifest: PluginManifest, { connection, profileValues }: ConnectionEditState): ConnectionDraft {
  const profiles: Partial<Record<UserId, ProfileDraft>> = {};
  for (const [userId, values] of profileValues) {
    profiles[userId] = { fields: values.fields, settings: values.settings, secrets: {}, ...(values.off ? { off: true } : {}) };
  }
  return {
    label: connection.label,
    enabled: connection.enabled,
    perProfile: connection.perProfile,
    shared: {
      fields: { ...defaultValues(manifest.connectionFields), ...connection.values.fields },
      settings: { ...defaultValues(manifest.settings), ...connection.values.settings },
      secrets: {},
    },
    profiles,
  };
}

export function isPerProfile(manifest: PluginManifest, mode: PerProfile, list: ValueList, key: string): boolean {
  return perProfileKeys(manifest, mode)[list].has(key);
}

/** Whose secrets an edit on this tab touches. */
export function secretScope(draft: ConnectionDraft, tab: UserId): SecretScope {
  return draft.perProfile === 'none' ? 'shared' : tab;
}

/** The value an input shows: the tab's own for a per-profile key, the shared one otherwise. */
export function valueFor(
  manifest: PluginManifest,
  draft: ConnectionDraft,
  tab: UserId,
  list: ValueList,
  key: string,
): FieldValue | undefined {
  if (!isPerProfile(manifest, draft.perProfile, list, key)) return draft.shared[list][key];
  return draft.profiles[tab]?.[list][key] ?? defaultOf(manifest, list, key);
}

export function setValue(
  manifest: PluginManifest,
  draft: ConnectionDraft,
  tab: UserId,
  list: ValueList,
  key: string,
  value: FieldValue,
): ConnectionDraft {
  if (!isPerProfile(manifest, draft.perProfile, list, key)) {
    return { ...draft, shared: { ...draft.shared, [list]: { ...draft.shared[list], [key]: value } } };
  }
  const own = draft.profiles[tab] ?? EMPTY;
  return { ...draft, profiles: { ...draft.profiles, [tab]: { ...own, [list]: { ...own[list], [key]: value } } } };
}

export function secretFor(draft: ConnectionDraft, tab: UserId, key: string): SecretChange | undefined {
  return draft.perProfile === 'none' ? draft.shared.secrets[key] : draft.profiles[tab]?.secrets[key];
}

export function setSecret(draft: ConnectionDraft, tab: UserId, key: string, change: SecretChange): ConnectionDraft {
  if (draft.perProfile === 'none') {
    return { ...draft, shared: { ...draft.shared, secrets: { ...draft.shared.secrets, [key]: change } } };
  }
  const own = draft.profiles[tab] ?? EMPTY;
  return { ...draft, profiles: { ...draft.profiles, [tab]: { ...own, secrets: { ...own.secrets, [key]: change } } } };
}

/**
 * "Don't use for this profile", and back. What the tab holds stays in the
 * draft, so switching back on in the same edit restores it; saving an off
 * profile keeps none of it, its password included.
 */
export function setProfileOff(draft: ConnectionDraft, tab: UserId, off: boolean): ConnectionDraft {
  const own = draft.profiles[tab] ?? EMPTY;
  const next: ProfileDraft = { fields: own.fields, settings: own.settings, secrets: own.secrets, ...(off ? { off: true } : {}) };
  return { ...draft, profiles: { ...draft.profiles, [tab]: next } };
}

export function isOffInDraft(draft: ConnectionDraft, tab: UserId): boolean {
  return draft.perProfile !== 'none' && draft.profiles[tab]?.off === true;
}

/**
 * A new mode for the draft. Switching away from `none`, the profile being
 * edited keeps the login everyone had — the saved password is moved, never
 * shown — and every other profile signs in on its own tab. Switching back to
 * `none`, the tab being edited becomes everyone's. Between the two splits, keys
 * that become per-profile start from the shared value for every profile that
 * already has values of its own.
 */
export function switchMode(
  manifest: PluginManifest,
  draft: ConnectionDraft,
  next: PerProfile,
  tab: UserId,
  saved: SavedSecrets,
): ConnectionDraft {
  const from = draft.perProfile;
  if (from === next) return draft;
  const fromKeys = perProfileKeys(manifest, from);
  const toKeys = perProfileKeys(manifest, next);
  const passwords = passwordKeys(manifest);

  if (from === 'none') {
    const own = draft.profiles[tab] ?? EMPTY;
    const secrets: Record<string, SecretChange> = { ...own.secrets };
    for (const key of passwords) {
      const typed = draft.shared.secrets[key];
      if (typeof typed === 'string' && typed !== '') secrets[key] = typed;
      else if (saved.shared.has(key)) secrets[key] = { adopt: 'shared' };
    }
    // The profile being edited keeps the login, so it is on whatever it was before.
    const seeded: ProfileDraft = {
      fields: { ...pickFrom(draft.shared.fields, toKeys.fields), ...own.fields },
      settings: { ...pickFrom(draft.shared.settings, toKeys.settings), ...own.settings },
      secrets,
    };
    return { ...draft, perProfile: next, profiles: { ...draft.profiles, [tab]: seeded } };
  }

  if (next === 'none') {
    const own = draft.profiles[tab] ?? EMPTY;
    const secrets: Record<string, SecretChange> = {};
    for (const key of passwords) {
      const typed = own.secrets[key];
      if (typeof typed === 'string' && typed !== '') secrets[key] = typed;
      else if (saved.profiles.get(tab)?.has(key)) secrets[key] = { adopt: tab };
      else secrets[key] = null;
    }
    return {
      ...draft,
      perProfile: next,
      shared: {
        fields: { ...draft.shared.fields, ...pickFrom(own.fields, fromKeys.fields) },
        settings: { ...draft.shared.settings, ...pickFrom(own.settings, fromKeys.settings) },
        secrets,
      },
    };
  }

  const becomingPerProfile = {
    fields: difference(toKeys.fields, fromKeys.fields),
    settings: difference(toKeys.settings, fromKeys.settings),
  };
  const becomingShared = {
    fields: difference(fromKeys.fields, toKeys.fields),
    settings: difference(fromKeys.settings, toKeys.settings),
  };
  const profiles: Partial<Record<UserId, ProfileDraft>> = {};
  for (const [userId, values] of Object.entries(draft.profiles) as [UserId, ProfileDraft | undefined][]) {
    if (!values) continue;
    profiles[userId] = {
      ...values,
      fields: { ...pickFrom(draft.shared.fields, becomingPerProfile.fields), ...values.fields },
      settings: { ...pickFrom(draft.shared.settings, becomingPerProfile.settings), ...values.settings },
    };
  }
  const own = draft.profiles[tab] ?? EMPTY;
  return {
    ...draft,
    perProfile: next,
    shared: {
      ...draft.shared,
      fields: { ...draft.shared.fields, ...pickFrom(own.fields, becomingShared.fields) },
      settings: { ...draft.shared.settings, ...pickFrom(own.settings, becomingShared.settings) },
    },
    profiles,
  };
}

/** How many profiles would lose values of their own if the draft were saved as it is. */
export function profilesLosingValues(draft: ConnectionDraft, stored: ConnectionEditState | undefined): number {
  if (!stored || draft.perProfile !== 'none') return 0;
  return stored.profileValues.size;
}

/** Whether a profile will be able to use the connection once the draft is saved. */
export function isSetUpInDraft(
  manifest: PluginManifest,
  draft: ConnectionDraft,
  tab: UserId,
  saved: SavedSecrets,
): boolean {
  if (draft.perProfile === 'none') return true;
  const own = draft.profiles[tab];
  if (!own || own.off) return false;
  const savedKeys = saved.profiles.get(tab) ?? new Set<string>();
  const secretKeys = passwordKeys(manifest).filter((key) => secretPresent(own.secrets[key], savedKeys.has(key)));
  return missingPerProfile(manifest, draft.perProfile, { fields: own.fields, settings: own.settings, secretKeys }).length === 0;
}

/** The values a probe of this tab runs with, and the secret changes of its scope. */
export function probeValues(
  manifest: PluginManifest,
  draft: ConnectionDraft,
  tab: UserId,
): { fields: FieldValues; settings: FieldValues; scope: SecretScope; secrets: ValuesDraft['secrets'] } {
  const keys = perProfileKeys(manifest, draft.perProfile);
  const own = draft.profiles[tab] ?? EMPTY;
  const merge = (list: ValueList): FieldValues => {
    const merged: Record<string, FieldValue> = {};
    for (const [key, value] of Object.entries(draft.shared[list])) if (!keys[list].has(key)) merged[key] = value;
    for (const key of keys[list]) {
      const value = own[list][key] ?? defaultOf(manifest, list, key);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  };
  const scope = secretScope(draft, tab);
  return { fields: merge('fields'), settings: merge('settings'), scope, secrets: scope === 'shared' ? draft.shared.secrets : own.secrets };
}

function defaultOf(manifest: PluginManifest, list: ValueList, key: string): FieldValue | undefined {
  const descriptor = (list === 'fields' ? manifest.connectionFields : manifest.settings).find((entry) => entry.key === key);
  return descriptor && descriptor.type !== 'password' ? descriptor.default : undefined;
}

function passwordKeys(manifest: PluginManifest): readonly string[] {
  return manifest.connectionFields.filter((field) => field.type === 'password').map((field) => field.key);
}

function pickFrom(values: FieldValues, keys: ReadonlySet<string>): FieldValues {
  return Object.fromEntries(Object.entries(values).filter(([key]) => keys.has(key)));
}

function difference(a: ReadonlySet<string>, b: ReadonlySet<string>): ReadonlySet<string> {
  return new Set([...a].filter((key) => !b.has(key)));
}
