import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { FileExchange, Logger } from '@/services/ports';

/**
 * Files in and out on a phone: out through the share sheet — Files, iCloud
 * Drive, a message — and in through the document picker. The file passes
 * through the cache directory both ways and is deleted after: it is
 * encrypted, but nothing of it should linger. The web build uses
 * `file-exchange.web.ts`.
 */
export function createFileExchange(log: Logger): FileExchange {
  const remove = (file: File) => {
    try {
      if (file.exists) file.delete();
    } catch (error) {
      log.warn('storage', 'A file in the cache could not be deleted', { error: String(error) });
    }
  };

  return {
    save: async (name, bytes) => {
      const file = new File(Paths.cache, name);
      remove(file);
      file.create();
      file.write(bytes);
      try {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', UTI: 'public.data', dialogTitle: name });
        return 'saved';
      } finally {
        remove(file);
      }
    },
    pick: async () => {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset) return undefined;
      const file = new File(asset.uri);
      return {
        name: asset.name,
        size: asset.size ?? file.size ?? 0,
        read: async () => {
          try {
            return await file.bytes();
          } finally {
            remove(file);
          }
        },
      };
    },
  };
}
