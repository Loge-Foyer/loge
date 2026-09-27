import {
  isAppError,
  type ConnectionId,
  type Credentials,
  type FieldValue,
  type FieldValues,
  type PluginId,
  type PluginManifest,
} from '@sc/api';
import { useState } from 'react';
import { Button, H2, Paragraph, SizableText, Spinner, XStack, YStack } from 'tamagui';

import { ConfirmButton } from '@/components/confirm-button';
import { describeProofVerdict, listAll } from '@/components/labels';
import { FieldInput } from '@/components/manifest-form';
import { OwnerProofForm } from '@/components/owner-proof-form';
import { PrimaryButton } from '@/components/primary-button';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useServices } from '@/hooks/services-context';
import { useAccount, useAccountProviders, useOwnerMethod } from '@/hooks/use-account';
import { useConnection } from '@/hooks/use-connections';
import { useRefreshLocalState } from '@/hooks/use-local-state';
import { AccountCreatedError, OwnerNotVerifiedError, type PreparedSignIn } from '@/services/account';
import { draftOf, initialDraft } from '@/services/connection-draft';
import { InvalidDraftError, type ConnectionDraft, type SavedSecrets, type SecretChange } from '@/services/connections';
import { defaultValues, hasErrors, hasFieldErrors, validateDraft, validateFields, type FieldErrors } from '@/services/field-values';

const NOTHING_SAVED: SavedSecrets = { shared: new Set(), profiles: new Map() };

/** Where signing in starts: the list of accounts, one plugin, one of this device's connections, or the account again. */
export type SignInStart =
  | { readonly kind: 'pick' }
  | { readonly kind: 'plugin'; readonly pluginId: PluginId }
  | { readonly kind: 'connection'; readonly connectionId: ConnectionId }
  | { readonly kind: 'again' };

interface Target {
  readonly manifest: PluginManifest;
  readonly connectionId?: ConnectionId;
}

/** What the details form sends on: a sign-in, or an account to create with these extra fields. */
interface Submitted {
  readonly draft: ConnectionDraft;
  readonly signUp?: FieldValues;
}

type Step =
  | { readonly kind: 'pick' }
  | {
      readonly kind: 'details';
      readonly target: Target;
      readonly draft?: ConnectionDraft;
      readonly error?: string;
      /** The account exists now: the form signs in to it, never creates it again. */
      readonly created?: true;
    }
  | { readonly kind: 'confirm'; readonly target: Target; readonly submitted: Submitted; readonly error?: string }
  | { readonly kind: 'ask'; readonly target: Target; readonly prepared: PreparedSignIn }
  | { readonly kind: 'switch'; readonly target: Target; readonly prepared: PreparedSignIn }
  | { readonly kind: 'completing' };

/**
 * Signing in to an account, shared by Welcome and Settings — so it uses no
 * profile's hooks: at first launch there is no profile. Each step has its own
 * Back. A sign-in that does not go through says why and is never tried again
 * by itself. The host decides what follows, and must not navigate when "Use
 * the account's profiles" took the profile in use: everything under it is gone.
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
  const { data: providers } = useAccountProviders();
  const { data: method } = useOwnerMethod();
  const refresh = useRefreshLocalState();
  const [step, setStep] = useState<Step>();
  const [confirming, setConfirming] = useState(false);
  // Switching away from an account that checks its owner with its password: typed again before anything is tried.
  const proofAsks = start.kind !== 'again' && current && method?.via === 'account' ? method.asks : [];

  const first = ((): Step | undefined => {
    if (current === undefined || providers === undefined) return undefined;
    switch (start.kind) {
      case 'again':
        return current?.manifest ? { kind: 'details', target: { manifest: current.manifest, connectionId: current.connection.id } } : undefined;
      case 'plugin': {
        const manifest = catalog.get(start.pluginId);
        return manifest ? { kind: 'details', target: { manifest } } : undefined;
      }
      case 'connection': {
        const provider = providers.find((candidate) => candidate.connections.some((connection) => connection.id === start.connectionId));
        return provider ? { kind: 'details', target: { manifest: provider.manifest, connectionId: start.connectionId } } : undefined;
      }
      case 'pick': {
        const only = providers.length === 1 ? providers[0] : undefined;
        return only && only.connections.length === 0 ? { kind: 'details', target: { manifest: only.manifest } } : { kind: 'pick' };
      }
    }
  })();
  const shown = step ?? first;

  if (current === undefined || providers === undefined) return null;
  if (!shown) {
    return (
      <YStack gap="$3" items="flex-start">
        <Paragraph color="$color11">
          {start.kind === 'again' ? 'This device is not signed in to an account.' : 'This account can’t be used in this version of the app.'}
        </Paragraph>
        <Button onPress={onCancel}>Back</Button>
      </YStack>
    );
  }

  const complete = async (target: Target, prepared: PreparedSignIn, profiles: 'account' | 'both') => {
    setStep({ kind: 'completing' });
    try {
      const result = await account.completeSignIn(prepared, profiles);
      await refresh({ remote: true });
      await onDone(result);
    } catch (error) {
      const message = describeSignInError(error);
      setStep({ kind: 'details', target, draft: prepared.draft, ...(message ? { error: message } : {}), ...(prepared.created ? { created: true } : {}) });
    }
  };

  const prepare = async (target: Target, { draft, signUp }: Submitted, proof?: Credentials) => {
    const prepared = await account.prepareSignIn(
      target.connectionId ? { connectionId: target.connectionId, draft } : { pluginId: target.manifest.id, draft, ...(signUp ? { signUp } : {}) },
      proof,
    );
    if (prepared.ask) setStep({ kind: 'ask', target, prepared });
    else if (prepared.switching) setStep({ kind: 'switch', target, prepared });
    else await complete(target, prepared, 'both');
  };

  const confirmThenPrepare = async (target: Target, submitted: Submitted, proof: Credentials) => {
    setConfirming(true);
    try {
      await prepare(target, submitted, proof);
    } catch (error) {
      if (error instanceof OwnerNotVerifiedError) {
        setStep({ kind: 'confirm', target, submitted, ...withError(describeProofVerdict(error.verdict)) });
      } else {
        const created = error instanceof AccountCreatedError;
        setStep({ kind: 'details', target, draft: submitted.draft, ...withError(describeSignInError(error)), ...(created ? { created: true } : {}) });
      }
    } finally {
      setConfirming(false);
    }
  };

  const backToDetails = (target: Target, prepared: PreparedSignIn) =>
    setStep({ kind: 'details', target, draft: prepared.draft, ...(prepared.created ? { created: true } : {}) });

  switch (shown.kind) {
    case 'pick':
      return (
        <YStack gap="$5">
          <StepHeading
            title="Choose your account"
            body="Your profiles and settings are kept in it, and every device signed in to it gets them."
          />
          {providers.map(({ manifest, connections }) => (
            <SettingsSection key={manifest.id} {...(connections.length > 0 ? { title: manifest.displayName } : {})}>
              <SettingsRow
                title={connections.length > 0 ? 'Another account' : manifest.displayName}
                subtitle={manifest.description}
                onPress={() => setStep({ kind: 'details', target: { manifest } })}
              />
              {connections.map((connection) => (
                <SettingsRow
                  key={connection.id}
                  title={connection.label}
                  subtitle="Already on this device"
                  onPress={() => setStep({ kind: 'details', target: { manifest, connectionId: connection.id } })}
                />
              ))}
            </SettingsSection>
          ))}
          <BackButton onPress={onCancel} />
        </YStack>
      );
    case 'details': {
      const back = first?.kind === 'pick' ? () => setStep({ kind: 'pick' }) : onCancel;
      const { target } = shown;
      const props = {
        manifest: target.manifest,
        passwordsOnly: start.kind === 'again',
        ...(shown.draft ? { restored: shown.draft } : {}),
        ...(shown.error ? { error: shown.error } : {}),
        ...(shown.created ? { created: true } : {}),
        onBack: back,
        onSubmit: async (submitted: Submitted) => {
          if (proofAsks.length > 0) setStep({ kind: 'confirm', target, submitted });
          else await prepare(target, submitted);
        },
      };
      return shown.target.connectionId ? (
        <ExistingDetails key={shown.target.connectionId} connectionId={shown.target.connectionId} {...props} />
      ) : (
        <DetailsForm
          key={shown.target.manifest.id}
          initial={initialDraft(shown.target.manifest, 0)}
          saved={NOTHING_SAVED}
          canCreate={start.kind !== 'again'}
          {...props}
        />
      );
    }
    case 'confirm': {
      const { target, submitted } = shown;
      return (
        <YStack gap="$5">
          <StepHeading
            title="Confirm it’s you"
            body={`${current?.connection.label ?? 'Your account'} asks for its password before this device moves to another account.`}
          />
          <OwnerProofForm
            asks={proofAsks}
            prompt={`The password of ${current?.connection.label ?? 'your account'}`}
            busy={confirming}
            error={shown.error}
            onSubmit={(proof) => void confirmThenPrepare(target, submitted, proof)}
            onCancel={() => setStep({ kind: 'details', target, draft: submitted.draft })}
          />
        </YStack>
      );
    }
    case 'ask': {
      const { prepared, target } = shown;
      const name = prepared.accountName ?? prepared.manifest.displayName;
      const removed = listAll(prepared.onlyHere);
      return (
        <YStack gap="$5">
          <StepHeading
            title="Profiles on both sides"
            body={`${name} has ${listAll(prepared.accountProfiles)}. ${removed} ${prepared.onlyHere.length === 1 ? 'is' : 'are'} only on this device.`}
          />
          {prepared.switching && current ? (
            <Paragraph size="$3" color="$color10">
              {`${current.connection.label} keeps what it has, and stops getting this device’s changes.`}
            </Paragraph>
          ) : null}
          <YStack gap="$3" items="stretch">
            <PrimaryButton onPress={() => void complete(target, prepared, 'both')}>Keep both</PrimaryButton>
            <ConfirmButton
              label="Use the account’s profiles"
              title={`Remove ${removed} from this device?`}
              description={`${
                prepared.onlyHere.length === 1
                  ? 'Everything kept for that profile goes with it, its settings and PIN included.'
                  : 'Everything kept for those profiles goes with them, their settings and PINs included.'
              } This device’s connections stay, and join ${name}.`}
              confirmLabel="Remove"
              onConfirm={() => void complete(target, prepared, 'account')}
            />
          </YStack>
          <BackButton onPress={() => backToDetails(target, prepared)} />
        </YStack>
      );
    }
    case 'switch': {
      const { prepared, target } = shown;
      const name = prepared.accountName ?? prepared.manifest.displayName;
      return (
        <YStack gap="$5">
          <StepHeading
            title={`Move your profiles and settings to ${name}?`}
            body={`Everything on this device goes to ${name}${current ? `. ${current.connection.label} keeps what it has, and stops getting this device’s changes` : ''}.`}
          />
          <PrimaryButton size="$5" onPress={() => void complete(target, prepared, 'both')}>
            Move
          </PrimaryButton>
          <BackButton onPress={() => backToDetails(target, prepared)} />
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
  /** Signing in again: the account stays the same, so only its passwords can change. */
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
 * The account's connection fields — nothing per profile, no roles: the account
 * belongs to the device. Where the plugin can create an account (`signUp`), it
 * offers to, with the extra fields that takes.
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
  const signUpFields = manifest.sync?.signUp?.fields ?? [];
  const [draft, setDraft] = useState(restored ?? initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState(error);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(createdBefore);
  const [creating, setCreating] = useState(false);
  const [signUp, setSignUp] = useState<FieldValues>(() => defaultValues(signUpFields));
  const offersCreate = canCreate && signUpFields.length > 0 && !created;
  const asCreate = offersCreate && creating;

  const setField = (key: string, value: FieldValue) =>
    setDraft((current) => ({ ...current, shared: { ...current.shared, fields: { ...current.shared.fields, [key]: value } } }));
  const setPassword = (key: string, change: SecretChange) =>
    setDraft((current) => ({ ...current, shared: { ...current.shared, secrets: { ...current.shared.secrets, [key]: change } } }));

  const submit = async () => {
    const found = validateDraft(manifest, draft, saved);
    const signUpErrors = asCreate ? validateFields(signUpFields, signUp) : {};
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

  const hasPasswords = manifest.connectionFields.some((field) => field.type === 'password');
  return (
    <YStack gap="$5">
      <StepHeading
        title={asCreate ? 'Create an account' : manifest.displayName}
        body={
          passwordsOnly
            ? hasPasswords
              ? 'Enter the password again. The rest stays as it is: another address would be another account.'
              : 'Sign in again with the details saved on this device.'
            : created
              ? 'Your account is there now. Sign in to it with the same details.'
              : asCreate
                ? 'Choose a username and a password. The password protects everything the account holds, and nothing can recover it.'
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
            ? signUpFields.map((field) => (
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
      {busy ? (
        <SizableText size="$2" color="$color10">
          {asCreate ? 'Creating your account' : 'Signing in'} — this can take a few seconds on a phone.
        </SizableText>
      ) : null}
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
    if (error.code === 'UNAUTHORIZED') return 'The account did not accept these details.';
    if (error.code === 'OFFLINE') return 'The account could not be reached. Check the network, then try again.';
    if (error.code === 'TIMEOUT') return 'The account took too long to answer.';
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

const withError = (message: string | undefined) => (message ? { error: message } : {});
