import type { Field, FieldValue, FieldValues, PluginManifest, PluginSettingDescriptor } from '@sc/api';

import type { ConnectionDraft } from './connections';

export type FieldErrors = Readonly<Record<string, string>>;

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
 * Problems with a draft, keyed by field. `savedSecrets` are the password
 * fields that already hold a value, which satisfies `required` until removed.
 */
export function validateDraft(
  manifest: PluginManifest,
  draft: ConnectionDraft,
  savedSecrets: ReadonlySet<string>,
): FieldErrors {
  const errors: Record<string, string> = {};
  if (draft.label.trim() === '') errors.label = 'Give this connection a name.';

  for (const field of manifest.connectionFields) {
    if (field.type === 'password') {
      const change = draft.secrets[field.key];
      const present = change === undefined ? savedSecrets.has(field.key) : change !== null && change !== '';
      if (field.required && !present) errors[field.key] = `${field.label} is required.`;
      continue;
    }
    const value = draft.fields[field.key];
    if ((field.type === 'text' || field.type === 'url') && field.required && !isFilled(value)) {
      errors[field.key] = `${field.label} is required.`;
    } else if (field.type === 'url' && isFilled(value) && !URL_LIKE.test(String(value).trim())) {
      errors[field.key] = 'Enter a full address, such as https://example.com.';
    }
  }

  for (const setting of manifest.settings) {
    const value = draft.settings[setting.key];
    if (setting.type === 'url' && isFilled(value) && !URL_LIKE.test(String(value).trim())) {
      errors[setting.key] = 'Enter a full address, such as https://example.com.';
    } else if ((setting.type === 'text' || setting.type === 'url') && setting.required && !isFilled(value)) {
      errors[setting.key] = `${setting.label} is required.`;
    }
  }
  return errors;
}

export const hasErrors = (errors: FieldErrors) => Object.keys(errors).length > 0;

function isFilled(value: FieldValue | undefined): boolean {
  return typeof value === 'string' ? value.trim() !== '' : value !== undefined;
}
