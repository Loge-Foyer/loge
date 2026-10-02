import { isAppError, type ConnectionId, type Credentials, type FieldValue, type FieldValues, type PluginId, type PluginManifest } from '@loge/api';
import { useState } from 'react';
import { H2, Paragraph, SizableText, Spinner, XStack, YStack } from 'tamagui';

import { Button } from '@/components/button';
import { describeProofVerdict, listAll } from '@/components/labels';
import { FieldInput } from '@/components/manifest-form';
import { OwnerProofForm } from '@/components/owner-proof-form';
import { PrimaryButton } from '@/components/primary-button';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { useAccount, useOwnerMethod } from '@/hooks/use-account';
import { useConnection } from '@/hooks/use-connections';
import { useRefreshLocalState } from '@/hooks/use-local-state';
import { AccountCreatedError, OwnerNotVerifiedError, type PreparedAccount } from '@/services/account';
import { draftOf, initialDraft } from '@/services/connection-draft';
import { InvalidDraftError, type ConnectionDraft, type SavedSecrets, type SecretChange } from '@/services/connections';
import { defaultValues, hasErrors, hasFieldErrors, validateDraft, validateFields, type FieldErrors } from '@/services/field-values';

const NOTHING_SAVED: SavedSecrets = { shared: new Set(), profiles: new Map() };

/** Where signing in starts: the list of servers, one plugin, or this device's account again. */
export type SignInStart = { readonly kind: 'pick' } | { readonly kind: 'plugin'; readonly pluginId: PluginId } | { readonly kind: 'again' };

/** What the details form sends on: a sign-in, or an account to create with these extra fields. */
interface Submitted {
  readonly draft: ConnectionDraft;
  readonly signUp?: FieldValues;
}

type Step =
  | { readonly kind: 'pick' }
  | {
      readonly kind: 'details';
      readonly manifest: PluginManifest;
      readonly draft?: ConnectionDraft;
      readonly error?: string;
      /** The account exists now: the form signs in to it, never creates it again. */
      readonly created?: true;
    }
  | { readonly kind: 'confirm'; readonly manifest: PluginManifest; readonly submitted: Submitted; readonly error?: string }
  | { readonly kind: 'replace'; readonly prepared: PreparedAccount }
  | { readonly kind: 'completing' };

/**
 * Signing in to your server, shared by Welcome and Settings — so it uses no
 * profile's hooks: at first launch there is no profile. Signing in replaces
 * this device's account with the one on the server, after saying so;
 * creating an account uploads this device's. A sign-in that does not go
 * through says why, and is never tried again by itself. The host decides what
 * follows, and must not navigate after a replace: it may have taken the
 * profile in use, and everything under it.
 */
export function SignInFlow({
  start,
  onCancel,
  onDone,
}: {
  start: SignInStart;
  /** Back from the first step. */
  onCancel: () => void;
  onDone: (result: { readonly profilesArrived: number }) => void | Promise<void>;
}) {
  const { account, catalog } = useServices();
  const { data: current } = useAccount();
  const { data: method } = useOwnerMethod();
  const refresh = useRefreshLocalState();
  const [step, setStep] = useState<Step>();
  const [confirming, setConfirming] = useState(false);
  const servers = account.servers();
  // Moving away from an account that checks its owner with its password: typed again before anything is tried.
  const proofAsks = start.kind !== 'again' && current?.kind === 'server' && method?.via === 'account' ? method.asks : [];

  const first = ((): Step | undefined => {
    if (current === undefined) return undefined;
    switch (start.kind) {
      case 'again':
        return current?.kind === 'server' && current.manifest ? { kind: 'details', manifest: current.manifest } : undefined;
      case 'plugin': {
        const manifest = catalog.get(start.pluginId);
        return manifest ? { kind: 'details', manifest } : undefined;
      }
      case 'pick': {
        const [only] = servers;
        return servers.length === 1 && only ? { kind: 'details', manifest: only } : { kind: 'pick' };
      }
    }
  })();
  const shown = step ?? first;

  if (current === undefined) return null;
  if (!shown) {
    return (
      <YStack gap="$3" items="flex-start">
        <Paragraph color="$color11">
          {start.kind === 'again' ? 'This device is not signed in to your server.' : 'This account can’t be used in this version of the app.'}
        </Paragraph>
        <Button onPress={onCancel}>Back</Button>
      </YStack>
    );
  }

  const complete = async (prepared: PreparedAccount) => {
    setStep({ kind: 'completing' });
    try {
      const result = await account.complete(prepared);
      await refresh({ remote: true });
      await onDone(result);
    } catch (error) {
      const message = describeSignInError(error);
      setStep({ kind: 'details', manifest: prepared.manifest, draft: prepared.draft, ...withError(message), ...(prepared.created ? { created: true } : {}) });
    }
  };

  const prepare = async (manifest: PluginManifest, { draft, signUp }: Submitted, proof?: Credentials) => {
    const prepared = await account.prepare(
      { pluginId: manifest.id, draft, ...(signUp ? { signUp } : {}), ...(start.kind === 'again' ? { again: true as const } : {}) },
      proof,
    );
    // A replace that takes this device's profiles away says so first.
    if (prepared.kind === 'replace' && prepared.deviceProfiles.length > 0) setStep({ kind: 'replace', prepared });
    else await complete(prepared);
  };

  const confirmThenPrepare = async (manifest: PluginManifest, submitted: Submitted, proof: Credentials) => {
    setConfirming(true);
    try {
      await prepare(manifest, submitted, proof);
    } catch (error) {
      if (error instanceof OwnerNotVerifiedError) {
        setStep({ kind: 'confirm', manifest, submitted, ...withError(describeProofVerdict(error.verdict)) });
      } else {
        const created = error instanceof AccountCreatedError;
        setStep({ kind: 'details', manifest, draft: submitted.draft, ...withError(describeSignInError(error)), ...(created ? { created: true } : {}) });
      }
    } finally {
      setConfirming(false);
    }
  };

  switch (shown.kind) {
    case 'pick':
      return (
        <YStack gap="$5">
          <StepHeading title="Your own server" body="Your profiles, their settings and your sources are kept there, and every device signed in to it gets them." />
          <SettingsSection>
            {servers.map((manifest) => (
              <SettingsRow key={manifest.id} title={manifest.displayName} subtitle={manifest.description} onPress={() => setStep({ kind: 'details', manifest })} />
            ))}
          </SettingsSection>
          <BackButton onPress={onCancel} />
        </YStack>
      );
    case 'details': {
      const back = first?.kind === 'pick' ? () => setStep({ kind: 'pick' }) : onCancel;
      const { manifest } = shown;
      const props = {
        manifest,
        passwordsOnly: start.kind === 'again',
        ...(shown.draft ? { restored: shown.draft } : {}),
        ...(shown.error ? { error: shown.error } : {}),
        ...(shown.created ? { created: true } : {}),
        onBack: back,
        onSubmit: async (submitted: Submitted) => {
          if (proofAsks.length > 0) setStep({ kind: 'confirm', manifest, submitted });
          else await prepare(manifest, submitted);
        },
      };
      return start.kind === 'again' && current?.kind === 'server' ? (
        <ExistingDetails connectionId={current.connection.id} {...props} />
      ) : (
        <DetailsForm key={manifest.id} initial={initialDraft(manifest, 0)} saved={NOTHING_SAVED} canCreate {...props} />
      );
    }
    case 'confirm': {
      const { manifest, submitted } = shown;
      const name = current?.name ?? 'your account';
      return (
        <YStack gap="$5">
          <StepHeading title="Confirm it’s you" body={`${name} asks for its password before this device moves to another account.`} />
          <OwnerProofForm
            asks={proofAsks}
            prompt={`The password of ${name}`}
            busy={confirming}
            error={shown.error}
            onSubmit={(proof) => void confirmThenPrepare(manifest, submitted, proof)}
            onCancel={() => setStep({ kind: 'details', manifest, draft: submitted.draft })}
          />
        </YStack>
      );
    }
    case 'replace': {
      const { prepared } = shown;
      const theirs = prepared.accountProfiles.length > 0 ? listAll(prepared.accountProfiles) : 'no profiles yet';
      return (
        <YStack gap="$5">
          <StepHeading
            title={`Use ${prepared.accountName} on this device?`}
            body={`It replaces what this device holds: ${listAll(prepared.deviceProfiles)}, with their PINs and settings, and this device’s sources. ${prepared.accountName} has ${theirs}.`}
          />
          <Paragraph size="$3" color="$color10">
            Accounts are never merged. To keep what is here, sign in to your server with a new account instead, and this device’s account goes up to it.
          </Paragraph>
          <PrimaryButton size="$5" onPress={() => void complete(prepared)}>
            Replace
          </PrimaryButton>
          <BackButton onPress={() => setStep({ kind: 'details', manifest: prepared.manifest, draft: prepared.draft })} />
        </YStack>
      );
    }
    case 'completing':
      return (
        <YStack items="center" gap="$4" py="$8">
          <Spinner size="large" color="$accent9" />
          <SizableText size="$4" color="$color11">
            Signing in…
          </SizableText>
        </YStack>
      );
  }
}

interface DetailsProps {
  manifest: PluginManifest;
  /** Signing in again: the account stays the same, so only its password can change. */
  passwordsOnly: boolean;
  /** What was typed before a step back. */
  restored?: ConnectionDraft;
  error?: string;
  /** The account was created already: signing in is all that is left. */
  created?: boolean;
  onBack: () => void;
  onSubmit: (submitted: Submitted) => Promise<void>;
}

function ExistingDetails({ connectionId, ...props }: DetailsProps & { connectionId: ConnectionId }) {
  const { data } = useConnection(connectionId);
  if (data === undefined) return null;
  if (data === null) {
    return (
      <YStack gap="$3" items="flex-start">
        <Paragraph color="$color11">This connection is no longer here.</Paragraph>
        <BackButton onPress={props.onBack} />
      </YStack>
    );
  }
  return <DetailsForm initial={draftOf(props.manifest, data)} saved={data.saved} canCreate={false} {...props} />;
}

/**
 * The server's connection fields — nothing per profile: this device's sign-in
 * belongs to the device. Where the plugin can create an account (`signUp`),
 * it offers to, with the extra fields that takes.
 */
function DetailsForm({
  manifest,
  initial,
  saved,
  canCreate,
  passwordsOnly,
  restored,
  error,
  created: createdBefore = false,
  onBack,
  onSubmit,
}: DetailsProps & { initial: ConnectionDraft; saved: SavedSecrets; canCreate: boolean }) {
  const signUpFields = manifest.account?.signUp?.fields;
  const [draft, setDraft] = useState(restored ?? initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState(error);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(createdBefore);
  const [creating, setCreating] = useState(false);
  const [signUp, setSignUp] = useState<FieldValues>(() => defaultValues(signUpFields ?? []));
  const offersCreate = canCreate && signUpFields !== undefined && !created;
  const asCreate = offersCreate && creating;

  const setField = (key: string, value: FieldValue) =>
    setDraft((current) => ({ ...current, shared: { ...current.shared, fields: { ...current.shared.fields, [key]: value } } }));
  const setPassword = (key: string, change: SecretChange) =>
    setDraft((current) => ({ ...current, shared: { ...current.shared, secrets: { ...current.shared.secrets, [key]: change } } }));

  const submit = async () => {
    const found = validateDraft(manifest, draft, saved);
    const signUpErrors = asCreate ? validateFields(signUpFields ?? [], signUp) : {};
    setErrors({ ...found.shared, ...signUpErrors });
    setMessage(found.form);
    if (hasErrors(found) || hasFieldErrors(signUpErrors)) return;
    setBusy(true);
    try {
      await onSubmit({ draft, ...(asCreate ? { signUp } : {}) });
    } catch (failure) {
      if (failure instanceof InvalidDraftError) {
        setErrors(failure.errors.shared);
        setMessage(failure.errors.form);
      } else {
        // Created, and not signed in yet: from here on, this form signs in to it.
        if (failure instanceof AccountCreatedError) {
          setCreated(true);
          setCreating(false);
        }
        setMessage(describeSignInError(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <YStack gap="$5">
      <StepHeading
        title={asCreate ? 'Create an account' : manifest.displayName}
        body={
          passwordsOnly
            ? 'Enter the password again. The rest stays as it is: another address would be another account.'
            : created
              ? 'Your account is there now. Sign in to it with the same details.'
              : asCreate
                ? 'Choose a username and a password. This device’s account goes up to it — its profiles, settings and sources.'
                : manifest.description
        }
      />
      {manifest.connectionFields.length > 0 ? (
        <YStack gap="$4" p="$4" rounded="$6" borderWidth={1} borderColor="$borderColor" bg="$color2">
          {manifest.connectionFields.map((field) => {
            if (field.type === 'password') {
              const change = draft.shared.secrets[field.key];
              return (
                <FieldInput
                  key={field.key}
                  field={field}
                  value={typeof change === 'string' ? change : undefined}
                  onChange={(value) => {
                    if (typeof value === 'string') setPassword(field.key, value);
                  }}
                  error={errors[field.key]}
                  saved={change !== null && saved.shared.has(field.key)}
                />
              );
            }
            return (
              <FieldInput
                key={field.key}
                field={field}
                value={draft.shared.fields[field.key]}
                onChange={(value) => setField(field.key, value)}
                error={errors[field.key]}
                disabled={passwordsOnly}
              />
            );
          })}
          {asCreate
            ? (signUpFields ?? []).map((field) => (
                <FieldInput
                  key={`sign-up-${field.key}`}
                  field={field}
                  value={signUp[field.key]}
                  onChange={(value) => setSignUp((current) => ({ ...current, [field.key]: value }))}
                  error={errors[field.key]}
                />
              ))
            : null}
        </YStack>
      ) : null}
      {offersCreate ? (
        <Button chromeless color="$accent10" self="flex-start" px={0} disabled={busy} onPress={() => setCreating(!creating)}>
          {creating ? 'Have an account? Sign in' : 'New here? Create an account'}
        </Button>
      ) : null}
      {message ? <SizableText color="$red10">{message}</SizableText> : null}
      <XStack gap="$3" items="center">
        <PrimaryButton size="$5" disabled={busy} onPress={() => void submit()}>
          {asCreate ? 'Create account' : 'Sign in'}
        </PrimaryButton>
        {busy ? <Spinner size="small" color="$accent9" /> : null}
      </XStack>
      <BackButton onPress={onBack} disabled={busy} />
    </YStack>
  );
}

function StepHeading({ title, body }: { title: string; body: string }) {
  return (
    <YStack gap="$2">
      <H2 size="$8" color="$color12">
        {title}
      </H2>
      <Paragraph size="$4" color="$color11">
        {body}
      </Paragraph>
    </YStack>
  );
}

function BackButton({ onPress, disabled = false }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Button chromeless color="$color10" self="flex-start" px={0} disabled={disabled} onPress={onPress}>
      Back
    </Button>
  );
}

/**
 * Why signing in did not go through, in words — the plugin's own for what it
 * refused, such as a used invite or a taken name. Nothing when someone backed
 * out of the owner check.
 */
function describeSignInError(error: unknown): string | undefined {
  if (error instanceof OwnerNotVerifiedError) return error.verdict === 'cancelled' ? undefined : error.message;
  if (error instanceof AccountCreatedError) {
    const why = describeSignInError(error.cause);
    return `${error.message}${why ? ` ${why}` : ''} Sign in to continue.`;
  }
  if (isAppError(error)) {
    if (error.reason === 'too-many-attempts') return error.message;
    if (error.code === 'UNAUTHORIZED') return 'Your server did not accept these details.';
    if (error.code === 'OFFLINE') return 'Your server could not be reached. Check the network, then try again.';
    if (error.code === 'TIMEOUT') return 'Your server took too long to answer.';
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

const withError = (message: string | undefined) => (message ? { error: message } : {});
