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
}

export interface UrlField extends FieldBase {
  readonly type: 'url';
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly default?: string;
}

/**
 * The only field whose value is secret. It goes to the credential store, never
 * to the database, and is never read back into a form — which is also why it
 * cannot declare a default.
 */
export interface PasswordField extends FieldBase {
  readonly type: 'password';
  readonly required?: boolean;
  readonly placeholder?: string;
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

export type Field = TextField | UrlField | PasswordField | BooleanField | SelectField;

export type FieldType = Field['type'];

export type FieldValue = string | boolean;

export type FieldValues = Readonly<Record<string, FieldValue>>;

/** The secret values of one connection, keyed by password-field key. */
export type Credentials = Readonly<Record<string, string>>;
