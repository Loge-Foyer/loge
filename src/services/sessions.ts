import {
  credentialsRef,
  type ConnectionId,
  type ConnectionValues,
  type CredentialsRef,
  type MediaContext,
  type PluginManifest,
  type UserId,
} from '@loge/api';

import type { SecureCredentialStore } from './ports';

/**
 * Whose credentials a connection runs with: everyone's shared ones, or one
 * profile's own — and, for the account, the device's. The account's session
 * is kept apart from the media role's, even on one connection.
 */
export type CredentialScope = 'shared' | 'account' | UserId;

export type SessionStore = MediaContext['session'];

/**
 * Where a scope's session lives. Derived, never stored, so nothing has to
 * remember it: a connection or profile that goes queues these for deletion.
 */
export function sessionRef(connectionId: ConnectionId, scope: CredentialScope): CredentialsRef {
  return credentialsRef(`session:${connectionId}:${scope}`);
}

/**
 * The credentials a session was made with: the connection fields, and the ref
 * of the secrets — which changes whenever a secret does. The secret itself is
 * never part of it.
 */
export function sessionIdentity(manifest: PluginManifest, values: ConnectionValues): string {
  const fields = manifest.connectionFields
    .filter((field) => field.type !== 'password')
    .map((field) => [field.key, values.fields[field.key] ?? null] as const);
  return JSON.stringify({ fields, credentialsRef: values.credentialsRef ?? null });
}

export interface Sessions {
  /**
   * The session store a plugin gets for one scope. A token saved for other
   * credentials is dropped when read: a new server address, username or
   * password always means signing in again.
   */
  bind(connectionId: ConnectionId, scope: CredentialScope, identity: string): SessionStore;
  /** For probing an unsaved draft; nothing outlives it. */
  ephemeral(): SessionStore;
}

/** `credentials` is the device-bound store: a token is valid for this device only. */
export function createSessions(credentials: SecureCredentialStore): Sessions {
  return {
    bind: (connectionId, scope, identity) => {
      const ref = sessionRef(connectionId, scope);
      return {
        read: async () => {
          const stored = await credentials.read(ref);
          if (!stored) return undefined;
          if (stored.identity !== identity) {
            await credentials.delete(ref);
            return undefined;
          }
          return stored.value;
        },
        write: (value) => credentials.write(ref, { value, identity }),
        clear: () => credentials.delete(ref),
      };
    },
    ephemeral: () => {
      let value: string | undefined;
      return {
        read: async () => value,
        write: async (next) => {
          value = next;
        },
        clear: async () => {
          value = undefined;
        },
      };
    },
  };
}
