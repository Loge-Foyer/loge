/**
 * Mock backups — a pretend place for the account's backup file, in memory and
 * keyed by its endpoint, with the conditional writes a real target has.
 * Development builds only.
 */
import { AppError, pluginId, type BackupStat, type ConnectedBackupTarget, type Plugin } from '@loge/api';

interface StoredFile {
  readonly bytes: Uint8Array;
  readonly stat: BackupStat;
}

// A reload forgets them all, as a real target never would: enough to try a backup's flows offline.
const places = new Map<string, Map<string, StoredFile>>();
let writes = 0;

export const plugin: Plugin = {
  manifest: {
    id: pluginId('sync/mock-backup'),
    category: 'sync',
    platforms: ['ios', 'android', 'web'],
    displayName: 'Mock backups',
    description: 'A pretend place for your backup file, kept in memory, for working offline.',
    backup: { location: 'Memory → Loge' },
    connectionFields: [{ key: 'endpoint', label: 'Endpoint', type: 'url', placeholder: 'mock://backups' }],
    settings: [],
  },
  backup: {
    connect: async (target, context): Promise<ConnectedBackupTarget> => {
      const endpoint = typeof target.fields.endpoint === 'string' && target.fields.endpoint !== '' ? target.fields.endpoint : 'mock://backups';
      const files = places.get(endpoint) ?? new Map<string, StoredFile>();
      places.set(endpoint, files);
      const found = (name: string) => {
        const file = files.get(name);
        if (!file) throw new AppError('NOT_FOUND', 'There is no such backup here.', { retry: 'never' });
        return file;
      };
      return {
        connectionId: target.connectionId,
        stat: async (name) => files.get(name)?.stat,
        read: async (name) => {
          const file = found(name);
          return { bytes: file.bytes.slice(), stat: file.stat };
        },
        write: async (name, bytes, ifMatch) => {
          const current = files.get(name);
          if (ifMatch !== undefined && current?.stat.etag !== ifMatch) {
            throw new AppError('SYNC_CONFLICT', 'The backup changed since this device last saw it.', { retry: 'never' });
          }
          writes += 1;
          const stat: BackupStat = {
            name,
            etag: `mock-${writes}`,
            modifiedAt: new Date(context.clock.now()).toISOString(),
            size: bytes.length,
          };
          files.set(name, { bytes: bytes.slice(), stat });
          return stat;
        },
        list: async () => [...files.values()].map((file) => file.stat),
        dispose: async () => {},
      };
    },
  },
};
