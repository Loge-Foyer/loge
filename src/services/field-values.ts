import {
  isLibrarySelection,
  perProfileKeys,
  perProfileModes,
  type Field,
  type FieldValue,
  type FieldValues,
  type PluginManifest,
  type PluginSettingDescriptor,
  type UserId,
} from '@sc/api';

import type { ConnectionDraft, ProfileDraft, SavedSecrets, SecretChange, ValuesDraft } from './connections';

export type FieldErrors = Readonly<Record<string, string>>;

/** Problems with a draft: the shared values, and each profile's own. */
export interface DraftErrors {
  readonly form?: string;
  readonly label?: string;
  readonly shared: FieldErrors;
  readonly profiles: Readonly<Partial<Record<UserId, FieldErrors>>>;
}

// Something that looks like scheme://host. `URL` is not relied on because
// React Native only partly implements it.
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\/[^\s/?#]+/i;

/** Starting values for a list of fields: declared defaults. Password fields never have one. */
export function defaultValues(fields: readonly (Field | PluginSettingDescriptor)[]): FieldValues {
  const values: Record<string, FieldValue> = {};
  for (const field of fields) {
    if (field.type === 'password') continue;
    if (field.default !== undefined) values[field.key] = field.default;
  }
  return values;
}

/**
 * The shared values must be complete; a profile's own need only be
 * well-formed. A profile that leaves something required empty is not set up
 * for this connection yet — a state to show, not an error to block on.
 */
export function validateDraft(manifest: PluginManifest, draft: ConnectionDraft, saved: SavedSecrets): DraftErrors {
  const keys = perProfileKeys(manifest, draft.perProfile);
  const profiles: Partial<Record<UserId, FieldErrors>> = {};
  for (const [userId, values] of Object.entries(draft.profiles) as [UserId, ProfileDraft | undefined][]) {
    // An off profile's values are not saved, so there is nothing to check.
    if (!values || values.off) continue;
    const errors = checkScope(manifest, values, {
      includes: (list, key) => keys[list].has(key),
      saved: saved.profiles.get(userId) ?? new Set(),
      complete: false,
    });
    if (hasFieldErrors(errors)) profiles[userId] = errors;
  }
  return {
    ...(draft.label.trim() === '' ? { label: 'Give this connection a name.' } : {}),
    ...(perProfileModes(manifest).includes(draft.perProfile)
      ? {}
      : { form: 'This source cannot keep separate values per profile in that way.' }),
    shared: checkScope(manifest, draft.shared, {
      includes: (list, key) => !keys[list].has(key),
      saved: saved.shared,
      complete: true,
    }),
    profiles,
  };
}

export function hasErrors(errors: DraftErrors): boolean {
  return (
    errors.form !== undefined ||
    errors.label !== undefined ||
    hasFieldErrors(errors.shared) ||
    Object.values(errors.profiles).some((profile) => profile !== undefined && hasFieldErrors(profile))
  );
}

export function hasFieldErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Whether a password has a value after this edit. `''` keeps what is saved. */
export function secretPresent(change: SecretChange | undefined, saved: boolean): boolean {
  if (change === undefined || change === '') return saved;
  return change !== null;
}

function checkScope(
  manifest: PluginManifest,
  values: ValuesDraft,
  scope: {
    includes: (list: 'fields' | 'settings', key: string) => boolean;
    saved: ReadonlySet<string>;
    complete: boolean;
  },
): FieldErrors {
  const errors: Record<string, string> = {};
  for (const field of manifest.connectionFields) {
    if (!scope.includes('fields', field.key)) continue;
    if (field.type === 'password') {
      const present = secretPresent(values.secrets[field.key], scope.saved.has(field.key));
      if (scope.complete && field.required && !present) errors[field.key] = `${field.label} is required.`;
      continue;
    }
    const value = values.fields[field.key];
    if ((field.type === 'text' || field.type === 'url') && field.required && scope.complete && !isFilled(value)) {
      errors[field.key] = `${field.label} is required.`;
    } else if (field.type === 'url' && isFilled(value) && !URL_LIKE.test(String(value).trim())) {
      errors[field.key] = 'Enter a full address, such as http://192.168.1.20:8096.';
    }
  }
  for (const setting of manifest.settings) {
    if (!scope.includes('settings', setting.key)) continue;
    const value = values.settings[setting.key];
    if (setting.type === 'url' && isFilled(value) && !URL_LIKE.test(String(value).trim())) {
      errors[setting.key] = 'Enter a full address, such as https://example.com.';
    } else if ((setting.type === 'text' || setting.type === 'url') && setting.required && scope.complete && !isFilled(value)) {
      errors[setting.key] = `${setting.label} is required.`;
    } else if (setting.type === 'libraries' && isLibrarySelection(value) && value.mode === 'only' && value.ids.length === 0) {
      errors[setting.key] = 'Choose at least one library, or show them all.';
    }
  }
  return errors;
}

/** Fields outside a connection — what creating an account takes (`sync.signUp`): the required ones filled in, addresses whole. */
export function validateFields(fields: readonly Field[], values: FieldValues): FieldErrors {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.key];
    if ((field.type === 'text' || field.type === 'url') && field.required && !isFilled(value)) {
      errors[field.key] = `${field.label} is required.`;
    } else if (field.type === 'url' && isFilled(value) && !URL_LIKE.test(String(value).trim())) {
      errors[field.key] = 'Enter a full address, such as https://example.com.';
    }
  }
  return errors;
}

function isFilled(value: FieldValue | undefined): boolean {
  return typeof value === 'string' ? value.trim() !== '' : value !== undefined;
}
