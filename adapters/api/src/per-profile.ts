import type { Connection, ConnectionValues, PerProfile } from './connection';
import type { Field, FieldValue, FieldValues } from './fields';
import type { PluginManifest } from './manifest';

/** Part of the account on the other side: a password, or a field marked as a credential. */
export function isCredential(field: Field): boolean {
  return field.type === 'password' || (field.type === 'text' && field.credential === true);
}

export interface PerProfileKeys {
  readonly fields: ReadonlySet<string>;
  readonly settings: ReadonlySet<string>;
}

/** The keys a mode keeps per profile. Everything else is shared. */
export function perProfileKeys(manifest: PluginManifest, mode: PerProfile): PerProfileKeys {
  switch (mode) {
    case 'none':
      return { fields: new Set(), settings: new Set() };
    case 'credentials':
      return {
        fields: new Set(manifest.connectionFields.filter(isCredential).map((field) => field.key)),
        settings: new Set(),
      };
    case 'all':
      return {
        fields: new Set(manifest.connectionFields.map((field) => field.key)),
        settings: new Set(manifest.settings.map((setting) => setting.key)),
      };
  }
}

/** The modes worth offering: `credentials` needs a credential field, and any split needs a value to split. */
export function perProfileModes(manifest: PluginManifest): readonly PerProfile[] {
  if (manifest.connectionFields.length + manifest.settings.length === 0) return ['none'];
  return manifest.connectionFields.some(isCredential) ? ['none', 'credentials', 'all'] : ['none', 'all'];
}

/**
 * The values one profile runs a connection with: the shared ones, with every
 * key its mode keeps per profile taken from the profile's own. Every password
 * field is a credential, so a mode that separates anything keeps all secrets
 * with the profile, and the profile's credentials ref replaces the shared one.
 */
export function resolveValues(
  manifest: PluginManifest,
  connection: Pick<Connection, 'perProfile' | 'values'>,
  profile: ConnectionValues | undefined,
): ConnectionValues {
  if (connection.perProfile === 'none') return connection.values;
  const keys = perProfileKeys(manifest, connection.perProfile);
  const own = profile ?? { fields: {}, settings: {} };
  return {
    fields: merge(connection.values.fields, own.fields, keys.fields),
    settings: merge(connection.values.settings, own.settings, keys.settings),
    ...(own.credentialsRef ? { credentialsRef: own.credentialsRef } : {}),
    ...(own.secretKeys ? { secretKeys: own.secretKeys } : {}),
  };
}

/**
 * Required per-profile keys that are still empty. A password counts once it is
 * saved; its value is never needed to know that.
 */
export function missingPerProfile(
  manifest: PluginManifest,
  mode: PerProfile,
  values: ConnectionValues,
): readonly string[] {
  const keys = perProfileKeys(manifest, mode);
  const saved = new Set(values.secretKeys ?? []);
  const missing: string[] = [];
  for (const field of manifest.connectionFields) {
    if (!keys.fields.has(field.key)) continue;
    if (field.type === 'password') {
      if (field.required && !saved.has(field.key)) missing.push(field.key);
    } else if ((field.type === 'text' || field.type === 'url') && field.required) {
      if (!isFilled(values.fields[field.key])) missing.push(field.key);
    }
  }
  for (const setting of manifest.settings) {
    if (!keys.settings.has(setting.key)) continue;
    if ((setting.type === 'text' || setting.type === 'url') && setting.required) {
      if (!isFilled(values.settings[setting.key])) missing.push(setting.key);
    }
  }
  return missing;
}

/**
 * Whether a profile can use a connection. Shared values serve every profile;
 * otherwise the profile needs its own values, with nothing required missing.
 */
export function isSetUpFor(
  manifest: PluginManifest,
  connection: Pick<Connection, 'perProfile'>,
  profile: ConnectionValues | undefined,
): boolean {
  if (connection.perProfile === 'none') return true;
  return profile !== undefined && missingPerProfile(manifest, connection.perProfile, profile).length === 0;
}

function merge(shared: FieldValues, own: FieldValues, perProfile: ReadonlySet<string>): FieldValues {
  const merged: Record<string, FieldValue> = {};
  for (const [key, value] of Object.entries(shared)) if (!perProfile.has(key)) merged[key] = value;
  for (const [key, value] of Object.entries(own)) if (perProfile.has(key)) merged[key] = value;
  return merged;
}

function isFilled(value: FieldValue | undefined): boolean {
  return typeof value === 'string' ? value.trim() !== '' : value !== undefined;
}
