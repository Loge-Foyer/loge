import { isLibrarySelection, selectsLibrary, type ContentKind, type FieldValue, type Library } from '@loge/api';

/**
 * Where a query looks. `undefined` stands for the whole server: the fast path
 * of the default "all libraries", one request with no parent at all.
 */
export interface LibraryScope {
  /** Identifies the scope, so a cursor made for another one is recognised. */
  readonly key: string;
  readonly parents: readonly (string | undefined)[];
}

export function scopeFor(
  selection: FieldValue | undefined,
  libraries: readonly Library[],
  kind: ContentKind,
): LibraryScope {
  if (!isLimited(selection)) return { key: 'all', parents: [undefined] };
  const ids = libraries
    .filter((library) => library.kinds.includes(kind) && selectsLibrary(selection, library.id))
    .map((library) => library.id);
  return { key: ids.join(','), parents: ids };
}

/** Only a selection that leaves something out needs the library list at all. */
export function isLimited(selection: FieldValue | undefined): boolean {
  return isLibrarySelection(selection) && selection.mode !== 'all';
}
