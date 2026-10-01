import type { Brand } from './brand';

export type PluginId = Brand<string, 'PluginId'>;
export type UserId = Brand<string, 'UserId'>;
export type ConnectionId = Brand<string, 'ConnectionId'>;

/** Opaque handle into the secure credential store — never the secret itself. */
export type CredentialsRef = Brand<string, 'CredentialsRef'>;

export const pluginId = (value: string): PluginId => value as PluginId;
export const userId = (value: string): UserId => value as UserId;
export const connectionId = (value: string): ConnectionId => value as ConnectionId;
export const credentialsRef = (value: string): CredentialsRef => value as CredentialsRef;
