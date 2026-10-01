import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { FileStore, TransferProgress, TransferRequest } from '@/services/ports';

/**
 * Files kept on the device. They live in the document directory, not the
 * cache: the system empties the cache under pressure, and a film someone
 * downloaded for a flight is not something to lose that way.
 */
const FOLDER = 'downloads';
/** Half-written until it is moved: a crash must never leave something that looks finished. */
const PARTIAL = '.part';

function folder(): Directory {
  const directory = new Directory(Paths.document, FOLDER);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

export function createFileStore(): FileStore {
  // A TV keeps nothing it may not lose: tvOS gives an app no storage the
  // system will not empty, so a download there would vanish under the user.
  // It says so, as a browser does, and nothing is ever queued.
  if (Platform.isTV) {
    const refuse = () => {
      throw new Error('Downloads are not available on a TV.');
    };
    return { available: false, fetch: refuse, used: async () => 0, free: async () => 0, remove: async () => undefined, sweep: async () => undefined, uriOf: () => refuse() };
  }
  return {
    available: true,

    fetch: async (request: TransferRequest): Promise<TransferProgress> => {
      const partial = new File(folder(), `${request.fileName}${PARTIAL}`);
      // Resuming: what is already there is what the server need not send again.
      const from = partial.exists ? partial.size : 0;
      let seen: TransferProgress = { bytesDone: from };
      const download = new DownloadTask(request.uri, partial, {
        headers: {
          ...request.headers,
          // A server that honours it sends the rest; one that does not sends
          // the whole file again, and the truncate below keeps that correct.
          ...(from > 0 ? { Range: `bytes=${from}-` } : {}),
        },
        onProgress: ({ bytesWritten, totalBytes }) => {
          seen = {
            bytesDone: from + bytesWritten,
            ...(totalBytes > 0 ? { bytesTotal: from + totalBytes } : {}),
          };
          request.onProgress(seen);
        },
        signal: request.signal,
      });
      await download.downloadAsync();
      const done = new File(folder(), request.fileName);
      if (done.exists) done.delete();
      partial.move(done);
      return { bytesDone: done.size, ...(seen.bytesTotal === undefined ? {} : { bytesTotal: seen.bytesTotal }) };
    },

    used: async () => {
      let total = 0;
      for (const entry of folder().list()) {
        if (entry instanceof File) total += entry.size;
      }
      return total;
    },

    free: async () => Paths.availableDiskSpace,

    remove: async (fileName) => {
      for (const name of [fileName, `${fileName}${PARTIAL}`]) {
        const file = new File(folder(), name);
        if (file.exists) file.delete();
      }
    },

    sweep: async (keep) => {
      for (const entry of folder().list()) {
        if (!(entry instanceof File)) continue;
        const name = entry.name.endsWith(PARTIAL) ? entry.name.slice(0, -PARTIAL.length) : entry.name;
        if (!keep.has(name)) entry.delete();
      }
    },

    uriOf: (fileName) => new File(folder(), fileName).uri,
  };
}
