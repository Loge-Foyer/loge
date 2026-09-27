import { AppError, isAppError } from '@sc/api';

/** Whatever an engine threw, as the typed error the rest of the app handles. */
export function storageError(error: unknown, message = 'The data on this device could not be read or saved.'): AppError {
  if (isAppError(error)) return error;
  return new AppError('STORAGE_FAILURE', message, { cause: error });
}

/** Refs and ids are all this layer ever puts in a message — never a value. */
export function missingRow(what: string, id: string): Error {
  return new Error(`Unknown ${what} ${id}`);
}
