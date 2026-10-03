import type { Credentials, PasswordField } from '@loge/api';
import { useState } from 'react';
import { Paragraph, SizableText, Spinner, XStack, YStack } from 'tamagui';

import { Button } from '@/components/button';
import { FieldInput } from '@/components/manifest-form';
import { PrimaryButton } from '@/components/primary-button';

/**
 * The owner check as a form: the account's password, typed again. Inline,
 * because a native alert cannot hold a text field. The key it gives takes a
 * few seconds to work out on a phone, so it says it is checking; and it tries
 * nothing again by itself.
 */
export function OwnerProofForm({
  asks,
  prompt,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  asks: readonly PasswordField[];
  prompt: string;
  busy: boolean;
  /** Why the last try did not go through, in words. */
  error?: string | undefined;
  onSubmit: (proof: Credentials) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const complete = asks.every((field) => (values[field.key] ?? '') !== '');
  const submit = () => {
    if (complete && !busy) onSubmit(values);
  };

  return (
    <YStack gap="$3" p="$4" rounded="$6" borderWidth={1} borderColor="$borderColor" bg="$color2" self="stretch">
      <Paragraph size="$3" color="$color11">
        {prompt}
      </Paragraph>
      {asks.map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          value={values[field.key]}
          disabled={busy}
          onChange={(value) => {
            if (typeof value === 'string') setValues((current) => ({ ...current, [field.key]: value }));
          }}
        />
      ))}
      {busy ? (
        <XStack gap="$2" items="center">
          <Spinner size="small" color="$accent9" />
          <SizableText size="$2" color="$color10">
            Checking — this can take a few seconds on a phone.
          </SizableText>
        </XStack>
      ) : error ? (
        <SizableText size="$2" color="$red11">
          {error}
        </SizableText>
      ) : null}
      <XStack gap="$3" items="center">
        <PrimaryButton disabled={!complete || busy} opacity={!complete || busy ? 0.6 : 1} onPress={submit}>
          Continue
        </PrimaryButton>
        <Button chromeless color="$color10" disabled={busy} onPress={onCancel}>
          Cancel
        </Button>
      </XStack>
    </YStack>
  );
}
