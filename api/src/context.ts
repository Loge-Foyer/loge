import type { PluginCrypto } from './crypto';
import type { Credentials, FieldValues } from './fields';
import type { CancelSignal, HttpClient } from './http';
import type { ConnectionId } from './ids';

/** One connection's values, resolved for the credential scope it runs with. */
export interface PluginTarget {
  readonly connectionId: ConnectionId;
  readonly fields: FieldValues;
  readonly settings: FieldValues;
}

export type NetworkKind = 'wifi' | 'ethernet' | 'cellular' | 'other' | 'none' | 'unknown';

/**
 * Everything a plugin may use from its host, whichever role it plays. Plugins
 * have no host globals — no fetch, no timers, no storage — so a test can hand
 * them fakes, and the app keeps secrets, logging and the network in one place.
 */
export interface PluginContext {
  readonly http: HttpClient;
  /** The target's password-field values. */
  readonly credentials: { read(): Promise<Credentials> };
  /**
   * A secret the plugin may keep between launches, such as a session token.
   * The app scopes it to this connection, role and credentials, and drops it
   * when any of them changes.
   */
  readonly session: {
    read(): Promise<string | undefined>;
    write(value: string): Promise<void>;
    clear(): Promise<void>;
  };
  readonly network: { current(): NetworkKind };
  readonly client: {
    readonly appName: string;
    readonly appVersion: string;
    readonly deviceName: string;
    /** Stable for this device, this connection and this set of credentials. */
    readonly installationId: string;
  };
  readonly clock: {
    now(): number;
    sleep(ms: number, signal?: CancelSignal): Promise<void>;
  };
  /** Random bytes, key derivation and sealing — an account's, for keys the server must never have. */
  readonly crypto: PluginCrypto;
}
