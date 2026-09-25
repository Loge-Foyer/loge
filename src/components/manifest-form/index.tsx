import type { FieldValue } from '@sc/api';
import { YStack } from 'tamagui';

import type { FieldErrors } from '@/services/field-values';

import { FieldInput, type FormField } from './field-input';

export { FieldInput, type FormField } from './field-input';

/** A plugin's declared fields, in declaration order. */
export function FieldList({
  fields,
  values,
  errors,
  onChange,
  disabled,
  savedSecrets,
  onRemoveSaved,
}: {
  fields: readonly FormField[];
  values: Readonly<Record<string, FieldValue | null>>;
  errors: FieldErrors;
  onChange: (key: string, value: FieldValue) => void;
  disabled?: boolean;
  savedSecrets?: ReadonlySet<string>;
  onRemoveSaved?: (key: string) => void;
}) {
  return (
    <YStack gap="$4">
      {fields.map((field) => {
        const value = values[field.key];
        const saved = field.type === 'password' && (savedSecrets?.has(field.key) ?? false) && value !== null;
        const optional = !('required' in field && field.required);
        return (
          <FieldInput
            key={field.key}
            field={field}
            value={value ?? undefined}
            onChange={(next) => onChange(field.key, next)}
            error={errors[field.key]}
            disabled={disabled ?? false}
            saved={saved}
            {...(saved && optional && onRemoveSaved ? { onRemoveSaved: () => onRemoveSaved(field.key) } : {})}
          />
        );
      })}
    </YStack>
  );
}
