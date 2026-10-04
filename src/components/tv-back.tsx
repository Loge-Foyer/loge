import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext } from 'react';

/** Where the remote is on a tab's page: whether on the first of its row, list or column, and how to get there. */
export interface TvSpot {
  readonly first: boolean;
  readonly toFirst: () => void;
}

/**
 * Back on a TV tab's first screen walks outwards (`TvTabs`): the remote goes
 * to the first control of the row, list or column it is in; from there to the
 * tabs' rail; and from the rail out of the app. A control that knows its row
 * says where it is as the remote lands on it (`at`) and leaves (`left`, which
 * clears only its own spot); a tab's first screen says while it is in front
 * (`root`).
 */
export interface TvBack {
  at(owner: unknown, spot: TvSpot): void;
  left(owner: unknown): void;
  root(inFront: boolean): void;
}

export const TvBackContext = createContext<TvBack | undefined>(undefined);

/** The tabs' Back, for a control on a tab's page; nothing off a TV, or outside the tabs. */
export function useTvBack(): TvBack | undefined {
  return useContext(TvBackContext);
}

/** Marks a tab's first screen: while it is in front, Back walks it before the rail and the app. */
export function useTvTabRoot(): void {
  const back = useContext(TvBackContext);
  useFocusEffect(
    useCallback(() => {
      if (!back) return undefined;
      back.root(true);
      return () => back.root(false);
    }, [back]),
  );
}
