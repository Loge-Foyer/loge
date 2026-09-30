import {
  encodeHex,
  isAppError,
  type AppErrorCode,
  type ConnectedBackupTarget,
  type Connection,
  type ConnectionId,
  type Credentials,
  type PluginCrypto,
} from '@sc/api';

import { pluginContext, secretsOf, type PluginContextDeps } from '../plugin-context';
import type { PluginCatalog } from '../plugin-catalog';
import type { AppActivity, ChangeJournal, IdGenerator, Logger, SecureCredentialStore, SyncDatabase } from '../ports';
import { sessionIdentity, type Sessions } from '../sessions';
import { tagOf } from './container';
import type { BackupService } from './index';

export type TargetPhase = 'idle' | 'saving' | 'saved' | 'conflict' | 'failed';

export interface TargetStatus {
  readonly connectionId: ConnectionId;
  readonly label: string;
  readonly phase: TargetPhase;
  readonly savedAt?: number;
  readonly problem?: { readonly code: AppErrorCode; readonly message: string };
  /** When the file on the target was last changed — by another device. */
  readonly theirsModifiedAt?: string;
}

/**
 * What a conflict can become. *Theirs*: the file on the target replaces this
 * device's account. *Mine*: this device's replaces the file. *Both*: this
 * device's account becomes an account of its own, saved beside theirs.
 */
export type ConflictChoice = 'theirs' | 'mine' | 'both';

export interface BackupTargets {
  /** The same array until something changes. */
  status(): readonly TargetStatus[];
  subscribe(listener: () => void): () => void;
  /** Reads which targets there are, and when each was last saved to. */
  load(): Promise<void>;
  /** Saves to every target now. Never throws: what went wrong is in the status. */
  saveNow(): Promise<void>;
  resolve(connectionId: ConnectionId, choice: ConflictChoice, proof?: Credentials): Promise<void>;
  /** Saves a moment after each journaled commit, and on going to the background when something changed. */
  start(): void;
  stop(): void;
}

// A burst of edits makes one save, not one each.
const AFTER_CHANGE_MS = 10_000;

/**
 * Keeps the account's backup file on every backup target this device has —
 * iCloud Drive, Google Drive, OneDrive — as it changes. A target only stores
 * bytes; the file is the same encrypted `.scbackup` an export writes.
 *
 * - **One file per account**, named after its lineage: two accounts never
 *   share a file, and only devices holding the same account can clash.
 * - **Never overwritten when it changed elsewhere.** Each save is
 *   conditional on the etag this device last saw (`backup_state`); a file
 *   it has not seen, or one changed since, stands the target in conflict
 *   until the user chooses.
 * - **An account on your server** is the same on every device signed in to
 *   it, so its file is simply the last one saved: no conflict to ask about.
 */
export function createBackupTargets(
  deps: PluginContextDeps & {
    readonly db: SyncDatabase;
    readonly catalog: PluginCatalog;
    readonly credentials: SecureCredentialStore;
    readonly sessions: Sessions;
    readonly backup: BackupService;
    readonly journal: ChangeJournal;
    readonly activity: AppActivity;
    readonly ids: IdGenerator;
    readonly log: Logger;
    readonly debounceMs?: number;
  },
): BackupTargets {
  const { db, catalog, backup } = deps;
  const crypto: PluginCrypto = deps.crypto;
  const statuses = new Map<ConnectionId, TargetStatus>();
  const listeners = new Set<() => void>();
  let snapshot: readonly TargetStatus[] = [];
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void)[] = [];
  // One save at a time; a save asked for meanwhile runs once after it.
  let running: Promise<void> | undefined;
  let again = false;

  const publish = () => {
    snapshot = [...statuses.values()];
    for (const listener of listeners) listener();
  };
  const set = (connection: Pick<Connection, 'id' | 'label'>, next: Omit<TargetStatus, 'connectionId' | 'label'>) => {
    statuses.set(connection.id, { connectionId: connection.id, label: connection.label, ...next });
    publish();
  };

  const targetConnections = async () => (await db.connections.list()).filter((connection) => catalog.backupRole(connection.pluginId) !== undefined);

  const connect = async (connection: Connection): Promise<ConnectedBackupTarget> => {
    const role = catalog.backupRole(connection.pluginId);
    const manifest = catalog.get(connection.pluginId);
    if (!role || !manifest) throw new Error(`Plugin "${connection.pluginId}" is not here.`);
    return role.connect(
      { connectionId: connection.id, fields: connection.values.fields, settings: connection.values.settings },
      await pluginContext(
        deps,
        `backup|${connection.pluginId}`,
        secretsOf(deps.credentials, connection.values),
        deps.sessions.bind(connection.id, 'shared', sessionIdentity(manifest, connection.values)),
      ),
    );
  };

  const fileNameOf = async (lineage: string) => `streaming-center-${encodeHex(await tagOf(crypto, 'lineage', lineage)).slice(0, 8)}.scbackup`;

  const failed = (connection: Connection, error: unknown, savedAt?: number) => {
    const code = isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE';
    const message = error instanceof Error ? error.message : String(error);
    deps.log.warn('backup', 'A backup could not be saved to a target', { code, plugin: connection.pluginId });
    set(connection, { phase: 'failed', problem: { code, message }, ...(savedAt === undefined ? {} : { savedAt }) });
  };

  /** One save to one target: conditional on the etag this device last saw there. */
  const saveTo = async (connection: Connection, file: { readonly bytes: Uint8Array }, name: string, lineage: string, generation: number, overwrite: boolean) => {
    const state = await db.backupState.get(connection.id);
    const savedAt = state?.savedAt;
    set(connection, { phase: 'saving', ...(savedAt === undefined ? {} : { savedAt }) });
    let target: ConnectedBackupTarget | undefined;
    try {
      target = await connect(connection);
      const remote = await target.stat(name);
      const known = state?.lineage === lineage ? state.etag : undefined;
      if (remote && remote.etag !== known && !overwrite) {
        set(connection, { phase: 'conflict', ...(remote.modifiedAt ? { theirsModifiedAt: remote.modifiedAt } : {}), ...(savedAt === undefined ? {} : { savedAt }) });
        return false;
      }
      const written = await target.write(name, file.bytes, remote?.etag);
      const now = deps.clock.now();
      await db.backupState.put({ connectionId: connection.id, lineage, generation, etag: written.etag, savedAt: now });
      set(connection, { phase: 'saved', savedAt: now });
      return true;
    } catch (error) {
      if (isAppError(error) && error.code === 'SYNC_CONFLICT') {
        set(connection, { phase: 'conflict', ...(savedAt === undefined ? {} : { savedAt }) });
      } else {
        failed(connection, error, savedAt);
      }
      return false;
    } finally {
      await target?.dispose().catch(() => undefined);
    }
  };

  const saveAll = async () => {
    const account = await db.account.get();
    const targets = await targetConnections();
    if (!account || targets.length === 0) {
      dirty = false;
      return;
    }
    const lineage = account.id;
    const name = await fileNameOf(lineage);
    let generation = 0;
    for (const target of targets) {
      const state = await db.backupState.get(target.id);
      if (state?.lineage === lineage) generation = Math.max(generation, state.generation);
    }
    generation += 1;
    let file;
    try {
      file = await backup.build({ generation });
    } catch (error) {
      for (const target of targets) failed(target, error);
      return;
    }
    let all = true;
    for (const target of targets) {
      // Every device of an account on your server holds the same account: the last save is as good as any.
      if (!(await saveTo(target, file, name, lineage, generation, account.kind === 'server'))) all = false;
    }
    if (all) dirty = false;
  };

  const run = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await saveAll().catch((error: unknown) => deps.log.error('backup', 'A backup save broke', { error: String(error) }));
      } while (again);
    })().finally(() => {
      running = undefined;
    });
    return running;
  };

  const load = async () => {
    const targets = await targetConnections();
    const present = new Set(targets.map((target) => target.id));
    for (const id of [...statuses.keys()]) if (!present.has(id)) statuses.delete(id);
    for (const target of targets) {
      const live = statuses.get(target.id);
      if (live && live.phase !== 'idle') {
        statuses.set(target.id, { ...live, label: target.label });
        continue;
      }
      const state = await db.backupState.get(target.id);
      statuses.set(target.id, {
        connectionId: target.id,
        label: target.label,
        phase: state?.savedAt === undefined ? 'idle' : 'saved',
        ...(state?.savedAt === undefined ? {} : { savedAt: state.savedAt }),
      });
    }
    publish();
  };

  return {
    status: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    load,

    saveNow: () => run(),

    resolve: async (connectionId, choice, proof) => {
      const connection = await db.connections.get(connectionId);
      const account = await db.account.get();
      if (!connection || !account) return;
      if (choice === 'both') {
        // A new lineage: this device's account becomes one of its own, and its file goes beside theirs.
        if (account.kind === 'local') await db.unjournaled((tx) => tx.account.put({ ...account, id: deps.ids.next() }));
        await run();
        return;
      }
      const name = await fileNameOf(account.id);
      if (choice === 'mine') {
        const state = await db.backupState.get(connection.id);
        const generation = (state?.lineage === account.id ? state.generation : 0) + 1;
        await saveTo(connection, await backup.build({ generation }), name, account.id, generation, true);
        return;
      }
      // Theirs: the file on the target replaces this device's account, checked through first.
      let target: ConnectedBackupTarget | undefined;
      try {
        target = await connect(connection);
        const { bytes, stat } = await target.read(name);
        const prepared = await backup.prepareWithOwnKey(bytes);
        await backup.completeImport(prepared, proof);
        const now = deps.clock.now();
        await db.backupState.put({ connectionId: connection.id, lineage: prepared.lineage, generation: prepared.generation, etag: stat.etag, savedAt: now });
        set(connection, { phase: 'saved', savedAt: now });
      } finally {
        await target?.dispose().catch(() => undefined);
      }
    },

    start: () => {
      if (unsubscribe.length > 0) return;
      const delay = deps.debounceMs ?? AFTER_CHANGE_MS;
      unsubscribe = [
        deps.journal.subscribe(() => {
          dirty = true;
          clearTimeout(timer);
          timer = setTimeout(() => void run(), delay);
        }),
        deps.activity.subscribe((active) => {
          if (active || !dirty) return;
          clearTimeout(timer);
          void run();
        }),
      ];
      void load().catch((error: unknown) => deps.log.warn('backup', 'The backup targets could not be read', { error: String(error) }));
    },

    stop: () => {
      for (const stop of unsubscribe) stop();
      unsubscribe = [];
      clearTimeout(timer);
    },
  };
}
