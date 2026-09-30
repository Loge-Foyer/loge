import {
  credentialsRef,
  DEFAULT_MAX_PROFILES,
  type AccountRecord,
  type Credentials,
  type PluginCrypto,
} from '@sc/api';

import { OwnerNotVerifiedError, type AccountService } from '../account';
import type { OwnerCheck } from '../owner-check';
import type { PluginCatalog } from '../plugin-catalog';
import type { BackupSql, Clock, PickedFile, RunLock, SecureCredentialStore, SyncDatabase } from '../ports';
import { removeAccountRowsIn } from '../removal';
import type { SecretJanitor } from '../secrets';
import { currentAccount } from '../sync/current';
import { SYNC_LOCK, type SyncEngine } from '../sync/engine';
import type { SyncParts } from '../sync/parts';
import { recordsOfAccount } from '../sync/records';
import { applyRecords, discardPlan, planRecords, unusedOf, type Outcome } from '../sync/reconcile';
import type { SyncScheduler } from '../sync/scheduler';
import { deriveBackupKeys, MAX_BACKUP_BYTES, openBackup, sealBackup, tagOf, type OpenFailure } from './container';
import { BACKUP_SCHEMA_VERSION, readBackupDatabase, writeBackupDatabase } from './database';
import { BACKUP_KEY_BYTES, decodeBase32, encodeBase32, formatBackupKey, parseBackupKey, type KeyProblem } from './key';

/** Where this device keeps its backup key: the device-bound store, never restored onto another phone. */
export const BACKUP_KEY_REF = credentialsRef('backup-key');

/** Why a backup was not read, in words the app shows. A lost key is plainly that: there is no way round it. */
export type BackupProblem = OpenFailure | KeyProblem;

export class BackupError extends Error {
  readonly problem: BackupProblem;

  constructor(problem: BackupProblem) {
    super(`The backup could not be read: ${problem}.`);
    this.name = 'BackupError';
    this.problem = problem;
  }
}

/** A backup checked through and through, and nothing replaced yet. Memory only: it holds every password. */
export interface PreparedImport {
  readonly lineage: string;
  readonly accountName: string;
  readonly createdAt: number;
  readonly profiles: readonly string[];
  readonly connections: number;
  readonly records: readonly AccountRecord[];
  readonly key: Uint8Array;
}

/** A file ready to save, and what it holds. */
export interface BackupFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly lineage: string;
}

export interface BackupService {
  /** The account as one encrypted file, under this device's key — made the first time. */
  exportFile(): Promise<BackupFile>;
  /** Whether this device has a backup key yet. */
  hasKey(): Promise<boolean>;
  /** The key, shown only after the owner check: it opens every password in the file. */
  showKey(proof?: Credentials): Promise<string>;
  /** The same file, for a backup target: its generation and name are the target's to choose. */
  build(options: { readonly generation: number; readonly lineage?: string }): Promise<BackupFile>;
  /**
   * Everything checked before anything is replaced: the size, the header, the
   * key, the seal, the database, every row. Throws `BackupError`.
   */
  prepareImport(file: PickedFile | Uint8Array, typedKey: string | Uint8Array): Promise<PreparedImport>;
  /** Opens a file with this device's own key, for a backup target's copy. */
  prepareWithOwnKey(bytes: Uint8Array): Promise<PreparedImport>;
  /**
   * Replaces this device's account with the backup's, as a local account —
   * after the owner check, and after signing out of your server first.
   */
  completeImport(prepared: PreparedImport, proof?: Credentials): Promise<{ readonly profilesArrived: number }>;
}

export function createBackupService(deps: {
  readonly db: SyncDatabase;
  readonly deviceBound: SecureCredentialStore;
  readonly crypto: PluginCrypto;
  readonly sql: BackupSql;
  readonly parts: SyncParts;
  readonly catalog: PluginCatalog;
  readonly owner: OwnerCheck;
  readonly account: AccountService;
  readonly engine: SyncEngine;
  readonly scheduler: SyncScheduler;
  readonly lock: RunLock;
  readonly janitor: SecretJanitor;
  readonly clock: Clock;
  readonly identity: () => Promise<{ readonly appVersion: string; readonly deviceKey: string }>;
}): BackupService {
  const { db, deviceBound, crypto, sql, parts } = deps;

  // As the account service guards its changes: nothing to protect on a device without profiles.
  const guard = async (reason: string, proof?: Credentials) => {
    if ((await db.users.list()).length === 0) return;
    const verdict = await deps.owner.verify(reason, proof);
    if (verdict === 'verified' || verdict === 'unavailable') return;
    throw new OwnerNotVerifiedError(verdict);
  };

  const savedKey = async (): Promise<Uint8Array | undefined> => {
    const saved = (await deviceBound.read(BACKUP_KEY_REF).catch(() => undefined))?.backupKey;
    const key = saved === undefined ? undefined : decodeBase32(saved);
    return key?.length === BACKUP_KEY_BYTES ? key : undefined;
  };

  const keyOrNew = async (): Promise<Uint8Array> => {
    const existing = await savedKey();
    if (existing) return existing;
    const key = crypto.randomBytes(BACKUP_KEY_BYTES);
    await deviceBound.write(BACKUP_KEY_REF, { backupKey: encodeBase32(key) });
    return key;
  };

  const build = async (options: { readonly generation: number; readonly lineage?: string }): Promise<BackupFile> => {
    const account = await db.account.get();
    const lineage = options.lineage ?? account?.id;
    if (!account || !lineage) throw new Error('There is no account to back up.');
    const { appVersion, deviceKey } = await deps.identity();
    const records = await recordsOfAccount(parts);
    const database = await writeBackupDatabase(sql, { lineage, accountName: account.name, appVersion, records });
    const keys = await deriveBackupKeys(await keyOrNew(), crypto);
    const bytes = await sealBackup(
      crypto,
      keys,
      {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        lineage: await tagOf(crypto, 'lineage', lineage),
        generation: options.generation,
        writer: await tagOf(crypto, 'writer', deviceKey),
        createdAt: deps.clock.now(),
      },
      database,
    );
    return { name: fileNameOf(account.name, deps.clock.now()), bytes, lineage };
  };

  const open = async (bytes: Uint8Array, key: Uint8Array): Promise<PreparedImport> => {
    const opened = await openBackup(crypto, await deriveBackupKeys(key, crypto), bytes);
    if (typeof opened === 'string') throw new BackupError(opened);
    if (opened.header.schemaVersion > BACKUP_SCHEMA_VERSION) throw new BackupError('newer');
    const contents = await readBackupDatabase(sql, opened.database);
    if (typeof contents === 'string') throw new BackupError(contents);
    // The header names the account too: a file whose two halves disagree was put together, not saved.
    const lineage = await tagOf(crypto, 'lineage', contents.lineage);
    if (lineage.some((byte, at) => opened.header.lineage[at] !== byte)) throw new BackupError('damaged');
    return {
      lineage: contents.lineage,
      accountName: contents.accountName,
      createdAt: opened.header.createdAt,
      profiles: contents.records.flatMap((record) => (record.kind === 'profile' && !record.deleted ? [record.data.name] : [])),
      connections: contents.records.filter((record) => record.kind === 'connection').length,
      records: contents.records,
      key,
    };
  };

  return {
    exportFile: () => build({ generation: 0 }),

    build,

    hasKey: async () => (await savedKey()) !== undefined,

    showKey: async (proof) => {
      await guard('Confirm it’s you to show the backup key', proof);
      return formatBackupKey(await keyOrNew(), crypto.sha256);
    },

    prepareImport: async (file, typedKey) => {
      // Refused before it is read: nothing this app writes comes near it.
      if (!(file instanceof Uint8Array) && file.size > MAX_BACKUP_BYTES) throw new BackupError('too-large');
      const key = typedKey instanceof Uint8Array ? typedKey : await parseBackupKey(typedKey, crypto.sha256);
      if (typeof key === 'string') throw new BackupError(key);
      return open(file instanceof Uint8Array ? file : await file.read(), key);
    },

    prepareWithOwnKey: async (bytes) => {
      const key = await savedKey();
      if (!key) throw new BackupError('wrong-key');
      return open(bytes, key);
    },

    completeImport: async (prepared, proof) => {
      const current = await currentAccount(db, deps.catalog);
      // Signing out asks for the owner itself; afterwards the account is this device's, and replaced.
      if (current?.kind === 'server') await deps.account.signOut(proof);
      else await guard('Confirm it’s you to replace this device’s account with the backup', proof);

      const plan = await planRecords(parts, prepared.records, { keepLocal: false });
      let outcome: Outcome | undefined;
      try {
        await deps.lock.run(SYNC_LOCK, async () => {
          outcome = await db.unjournaled(async (tx) => {
            await removeAccountRowsIn(tx);
            await tx.account.clear();
            await tx.account.put({ kind: 'local', id: prepared.lineage, name: prepared.accountName });
            await tx.journal.prune(await tx.journal.head());
            const applied = await applyRecords(tx, parts, plan, { maxProfiles: DEFAULT_MAX_PROFILES, restoreLost: false });
            await tx.staleSecrets.add(unusedOf(plan, applied));
            return applied;
          });
        });
      } catch (error) {
        await discardPlan(parts, plan);
        throw error;
      }
      // The key that opened it is this device's from now on: one key for the account, wherever it is.
      await deviceBound.write(BACKUP_KEY_REF, { backupKey: encodeBase32(prepared.key) });
      await deps.janitor.drain();
      if (outcome) deps.engine.report(outcome);
      await deps.scheduler.accountChanged();
      return { profilesArrived: outcome?.arrivedProfiles.size ?? 0 };
    },
  };
}

/** `streaming-center-the-smiths-2026-09-30.scbackup`: safe on every file system, and sorted by date. */
export function fileNameOf(accountName: string, now: number): string {
  const slug = accountName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `streaming-center-${slug || 'account'}-${new Date(now).toISOString().slice(0, 10)}.scbackup`;
}
