interface FieldBase {
  /** Storage key, unique within the list that declares it. */
  readonly key: string;
  readonly label: string;
  /** Helper text shown with the input. */
  readonly description?: string;
}

export interface TextField extends FieldBase {
  readonly type: 'text';
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly default?: string;
  /**
   * Part of the account on the other side, such as a username. A connection
   * that separates credentials per profile keeps it per profile, with the
   * password fields — which always count as credentials.
   */
  readonly credential?: true;
}

export interface UrlField extends FieldBase {
  readonly type: 'url';
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly default?: string;
}

/**
 * The only field whose value is secret. It goes to the credential store, never
 * to the database, and is never read back into a form unless it is `visible` —
 * which is also why it cannot declare a default.
 */
export interface PasswordField extends FieldBase {
  readonly type: 'password';
  readonly required?: boolean;
  readonly placeholder?: string;
  /**
   * Shown as it is typed, and read back to be edited: a credential that signs
   * in on its own but is no secret to the person holding it — a portal's MAC
   * address, which is tedious to type unseen and worth checking later. Still a
   * password to storage: the credential store, never a row.
   */
  readonly visible?: true;
}

export interface BooleanField extends FieldBase {
  readonly type: 'boolean';
  readonly default: boolean;
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectField extends FieldBase {
  readonly type: 'select';
  readonly options: readonly SelectOption[];
  readonly default: string;
}

/**
 * Which of a source's libraries a connection shows. `except` also shows
 * libraries the source adds later; `only` does not.
 */
export type LibrarySelection =
  | { readonly mode: 'all' }
  | { readonly mode: 'only' | 'except'; readonly ids: readonly string[] };

/**
 * A choice among the libraries the source itself reports. It can only be a
 * setting: the app fills its options by asking the connection, so the plugin
 * must declare the `libraries` capability.
 */
export interface LibrariesField extends FieldBase {
  readonly type: 'libraries';
  readonly default: LibrarySelection;
}

export type Field = TextField | UrlField | PasswordField | BooleanField | SelectField;

export type FieldType = Field['type'];

export type FieldValue = string | boolean | LibrarySelection;

export type FieldValues = Readonly<Record<string, FieldValue>>;

/** The secret values of one connection, keyed by password-field key. */
export type Credentials = Readonly<Record<string, string>>;

export function isLibrarySelection(value: unknown): value is LibrarySelection {
  if (typeof value !== 'object' || value === null) return false;
  const { mode, ids } = value as { mode?: unknown; ids?: unknown };
  if (mode === 'all') return true;
  return (
    (mode === 'only' || mode === 'except') &&
    Array.isArray(ids) &&
    ids.every((id) => typeof id === 'string')
  );
}

/** Whether `id` passes a selection. Anything but a valid selection means all. */
export function selectsLibrary(selection: FieldValue | undefined, id: string): boolean {
  if (!isLibrarySelection(selection) || selection.mode === 'all') return true;
  return selection.mode === 'only' ? selection.ids.includes(id) : !selection.ids.includes(id);
}
