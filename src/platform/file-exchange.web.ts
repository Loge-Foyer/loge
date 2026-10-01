import * as DocumentPicker from 'expo-document-picker';

import type { FileExchange, Logger } from '@/services/ports';

// Long enough for any browser to have taken the file; the URL is released after.
const RELEASE_AFTER_MS = 60_000;

/** Files in and out in a browser: a download, and a file input through the document picker's web build. */
export function createFileExchange(_log: Logger): FileExchange {
  return {
    available: true,
    save: async (name, bytes) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), RELEASE_AFTER_MS);
      return 'saved';
    },
    pick: async () => {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false });
      const asset = result.canceled ? undefined : result.assets[0];
      const file = asset?.file;
      if (!asset || !file) return undefined;
      return { name: asset.name, size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()) };
    },
  };
}
