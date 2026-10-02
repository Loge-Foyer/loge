import type { PluginContext, PluginTarget } from './context';
import type { CancelSignal } from './http';
import type { ConnectionId } from './ids';

/**
 * A place to keep the account's backup file: iCloud Drive, Google Drive,
 * OneDrive. A target only stores bytes. What they hold, and how they are
 * encrypted, is the app's.
 */

export interface BackupManifest {
  /** Where the file goes, in words, for Settings: "iCloud Drive → Loge". */
  readonly location: string;
}

export interface BackupStat {
  readonly name: string;
  /** Changes whenever the file does, so a write can refuse to overwrite a newer one. */
  readonly etag: string;
  /** ISO 8601. */
  readonly modifiedAt?: string;
  readonly size?: number;
}

export interface ConnectedBackupTarget {
  readonly connectionId: ConnectionId;
  /** Nothing when there is no such file. */
  stat(name: string, signal?: CancelSignal): Promise<BackupStat | undefined>;
  read(name: string, signal?: CancelSignal): Promise<{ readonly bytes: Uint8Array; readonly stat: BackupStat }>;
  /** With `ifMatch`, refuses with `SYNC_CONFLICT` when the file changed since that etag. */
  write(name: string, bytes: Uint8Array, ifMatch?: string, signal?: CancelSignal): Promise<BackupStat>;
  list(signal?: CancelSignal): Promise<readonly BackupStat[]>;
  dispose(): Promise<void>;
}

/** Connecting does no network work; signing in waits for the first call. */
export interface BackupRole {
  connect(target: PluginTarget, context: PluginContext): Promise<ConnectedBackupTarget>;
}

/** The members every connected backup target has. */
export const BACKUP_MEMBERS = ['stat', 'read', 'write', 'list', 'dispose'] as const satisfies readonly (keyof ConnectedBackupTarget)[];
