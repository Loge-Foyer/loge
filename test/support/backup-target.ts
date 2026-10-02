// A pretend backup target — iCloud Drive, Google Drive — that several devices
// in one test share: files by name, with the conditional writes a real one has.
import { AppError, pluginId, type BackupStat, type Plugin } from '@loge/api';

export interface FakeBackupTarget {
  readonly plugin: Plugin;
  readonly files: Map<string, { readonly bytes: Uint8Array; readonly stat: BackupStat }>;
  readonly calls: { writes: number; reads: number };
}

export function fakeBackupTarget(id = 'fake-backups'): FakeBackupTarget {
  const files = new Map<string, { readonly bytes: Uint8Array; readonly stat: BackupStat }>();
  const calls = { writes: 0, reads: 0 };
  let versions = 0;
  const plugin: Plugin = {
    manifest: {
      id: pluginId(`sync/${id}`),
      category: 'sync',
      platforms: ['ios', 'android', 'web'],
      displayName: 'Fake backups',
      description: 'A place for backups that exists only in tests.',
      backup: { location: 'Memory → Loge' },
      connectionFields: [{ key: 'folder', label: 'Folder', type: 'text' }],
      settings: [],
    },
    backup: {
      connect: async (target) => ({
        connectionId: target.connectionId,
        stat: async (name) => files.get(name)?.stat,
        read: async (name) => {
          calls.reads += 1;
          const file = files.get(name);
          if (!file) throw new AppError('NOT_FOUND', 'No such backup.', { retry: 'never' });
          return { bytes: file.bytes.slice(), stat: file.stat };
        },
        write: async (name, bytes, ifMatch) => {
          if (ifMatch !== undefined && files.get(name)?.stat.etag !== ifMatch) {
            throw new AppError('SYNC_CONFLICT', 'The backup changed since.', { retry: 'never' });
          }
          calls.writes += 1;
          versions += 1;
          const stat: BackupStat = { name, etag: `etag-${versions}`, modifiedAt: new Date(1_790_000_000_000 + versions).toISOString(), size: bytes.length };
          files.set(name, { bytes: bytes.slice(), stat });
          return stat;
        },
        list: async () => [...files.values()].map((file) => file.stat),
        dispose: async () => undefined,
      }),
    },
  };
  return { plugin, files, calls };
}
