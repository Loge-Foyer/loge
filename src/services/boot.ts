import type { AppUser, UserId } from '@sc/api';

/** Which part of the app is reachable. Routes are guarded on this, one guard each. */
export type Gate =
  | { readonly kind: 'starting' }
  | { readonly kind: 'failed'; readonly message: string }
  // No account yet: make one here, sign in to your server, or restore a backup.
  | { readonly kind: 'needs-account' }
  // An account with no profile left: it asks for a first one.
  | { readonly kind: 'needs-first-user' }
  | { readonly kind: 'needs-user-selection' }
  | { readonly kind: 'needs-user-unlock'; readonly userId: UserId }
  | { readonly kind: 'ready'; readonly userId: UserId };

export interface BootFacts {
  /** Whether the device has an account, kept here or on your own server. */
  readonly hasAccount: boolean;
  readonly users: readonly AppUser[];
  /** A device setting, not a profile attribute. */
  readonly defaultUserId: UserId | undefined;
}

export interface BootDecision {
  readonly gate: Gate;
  /** The default user no longer exists, so the setting must be cleared. */
  readonly clearDefaultUser: boolean;
}

/** The launch decision tree (spec §6), pure so it can be tested without a screen. */
export function decideInitialGate({ hasAccount, users, defaultUserId }: BootFacts): BootDecision {
  if (!hasAccount) return { gate: { kind: 'needs-account' }, clearDefaultUser: defaultUserId !== undefined };
  if (users.length === 0) {
    return { gate: { kind: 'needs-first-user' }, clearDefaultUser: defaultUserId !== undefined };
  }
  if (defaultUserId === undefined) {
    return { gate: { kind: 'needs-user-selection' }, clearDefaultUser: false };
  }
  const user = users.find((candidate) => candidate.id === defaultUserId);
  if (!user) return { gate: { kind: 'needs-user-selection' }, clearDefaultUser: true };
  return {
    gate: user.pinProtected
      ? { kind: 'needs-user-unlock', userId: user.id }
      : { kind: 'ready', userId: user.id },
    clearDefaultUser: false,
  };
}
