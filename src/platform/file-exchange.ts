import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { FileExchange, Logger } from '@/services/ports';

// Loaded on first use: an Apple TV build has neither, and importing them
// there would throw as the app starts.
const documentPicker = () => import('expo-document-picker');
const sharing = () => import('expo-sharing');

/**
 * Files in and out on a phone: out through the share sheet — Files, iCloud
 * Drive, a message — and in through the document picker. The file passes
 * through the cache directory both ways and is deleted after: it is
 * encrypted, but nothing of it should linger. The web build uses
 * `file-exchange.web.ts`. A TV has no share sheet, no files and no picker,
 * and says so, so nothing offers to move a file there.
 */
export function createFileExchange(log: Logger): FileExchange {
  if (Platform.isTV) {
    const refuse = async (): Promise<never> => {
      throw new Error('A TV has nowhere to move a file to or from.');
    };
    return { available: false, save: refuse, pick: refuse };
  }

  const remove = (file: File) => {
    try {
      if (file.exists) file.delete();
    } catch (error) {
      log.warn('storage', 'A file in the cache could not be deleted', { error: String(error) });
    }
  };

  return {
    available: true,
    save: async (name, bytes) => {
      const file = new File(Paths.cache, name);
      remove(file);
      file.create();
      file.write(bytes);
      try {
        await (await sharing()).shareAsync(file.uri, { mimeType: 'application/octet-stream', UTI: 'public.data', dialogTitle: name });
        return 'saved';
      } finally {
        remove(file);
      }
    },
    pick: async () => {
      const result = await (await documentPicker()).getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
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
