import {
  isAppError,
  perProfileKeys,
  perProfileModes,
  type AppUser,
  type BooleanField,
  type ConnectionId,
  type FieldValue,
  type PerProfile,
  type PluginId,
  type PluginManifest,
  type SelectField,
  type SourceInfo,
  type UserId,
} from '@sc/api';
import { Trash2 } from '@tamagui/lucide-icons-2/icons/Trash2';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Label, Paragraph, SizableText, Spinner, XStack, YStack } from 'tamagui';

import { Button } from '@/components/button';
import { ConfirmButton } from '@/components/confirm-button';
import { describeProbeError, listAll, listKinds, PER_PROFILE_DESCRIPTIONS, PER_PROFILE_LABELS } from '@/components/labels';
import { FieldInput, type FormField, type LibrariesProbe } from '@/components/manifest-form';
import { PinPad } from '@/components/pin-pad';
import { PrimaryButton } from '@/components/primary-button';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { SourceTabs, type SourceTab } from '@/components/source-tabs';
import { TextInput } from '@/components/text-input';
import { useServices } from '@/hooks/services-context';
import { useConnection, useConnectionActions, usePluginConnections } from '@/hooks/use-connections';
import { usePluginManifest } from '@/hooks/use-plugins';
import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';
import { describeFailure } from '@/screens/unlock';
import {
  draftOf,
  initialDraft,
  isOffInDraft,
  isPerProfile,
  isSetUpInDraft,
  probeValues,
  profilesLosingValues,
  secretFor,
  setProfileOff,
  setSecret,
  setValue,
  switchMode,
  valueFor,
  type ValueList,
} from '@/services/connection-draft';
import {
  InvalidDraftError,
  savedSecretsOf,
  type ConnectionDraft,
  type ConnectionEditState,
  type SavedSecrets,
} from '@/services/connections';
import { hasErrors, hasFieldErrors, validateDraft, type DraftErrors } from '@/services/field-values';
import type { ProbeTarget } from '@/services/media';
import { showsOn } from '@/services/tab-content';

const NO_ERRORS: DraftErrors = { shared: {}, profiles: {} };
const NOTHING_SAVED: SavedSecrets = { shared: new Set(), profiles: new Map() };

export function NewConnectionScreen({ pluginId }: { pluginId: PluginId }) {
  const manifest = usePluginManifest(pluginId);
  const { data: existing } = usePluginConnections(pluginId);
  const { create } = useConnectionActions();
  if (!manifest || !existing) return <Missing loading={!!manifest} />;
  // Only sources and IPTV are connected here: an account is chosen in Settings → Account.
  // Sources and IPTV, and the places backups go; an account is chosen in Settings → Account.
  if (!manifest.media && !manifest.backup) return <NotHere manifest={manifest} />;
  return (
    <ConnectionForm
      title={`New ${manifest.displayName} connection`}
      manifest={manifest}
      initial={initialDraft(manifest, existing.length)}
      saved={NOTHING_SAVED}
      submitLabel="Add connection"
      onSubmit={(draft) => create.mutateAsync({ pluginId, draft })}
    />
  );
}

export function EditConnectionScreen({ connectionId }: { connectionId: ConnectionId }) {
  const { data } = useConnection(connectionId);
  const manifest = usePluginManifest((data?.connection.pluginId ?? '') as PluginId);
  const { update, remove } = useConnectionActions();
  if (data === undefined) return <Missing loading />;
  if (data === null) return <Missing loading={false} />;
  // Kept for the devices that can run it — IPTV on the web.
  if (!manifest) return <Unavailable label={data.connection.label} />;
  // Sources and IPTV, and the places backups go; an account is chosen in Settings → Account.
  if (!manifest.media && !manifest.backup) return <NotHere manifest={manifest} />;
  return (
    <ConnectionForm
      title={data.connection.label}
      manifest={manifest}
      connectionId={connectionId}
      stored={data}
      initial={draftOf(manifest, data)}
      saved={savedSecretsOf(data.connection, data.profileValues)}
      submitLabel="Save"
      onSubmit={(draft) => update.mutateAsync({ id: connectionId, draft })}
      onRemove={() => remove.mutate(connectionId, { onSuccess: () => router.back() })}
    />
  );
}

function Missing({ loading }: { loading: boolean }) {
  return (
    <Screen>{loading ? null : <SizableText color="$color10">This connection no longer exists.</SizableText>}</Screen>
  );
}

function Unavailable({ label }: { label: string }) {
  return (
    <Screen>
      <Stack.Screen options={{ title: label }} />
      <Paragraph color="$color11">
        {`${label} isn’t available on this device. Its details are kept for the devices that can use it.`}
      </Paragraph>
    </Screen>
  );
}

/** A sync plugin: the device's own, and never edited in a connection form. */
function NotHere({ manifest }: { manifest: PluginManifest }) {
  const { catalog } = useServices();
  const usable = catalog.accountRole(manifest.id) !== undefined;
  return (
    <Screen>
      <Stack.Screen options={{ title: manifest.displayName }} />
      <Paragraph color="$color11">
        {usable
          ? `${manifest.displayName} is where your account can live, not a source. Sign in to it, or change how you sign in, in Settings → Account.`
          : `${manifest.displayName} can’t be set up in this version of the app yet.`}
      </Paragraph>
      {usable ? (
        <SettingsSection>
          <SettingsRow title="Settings → Account" href="/settings/account" />
        </SettingsSection>
      ) : null}
    </Screen>
  );
}

function enabledField(manifest: PluginManifest): BooleanField {
  const kinds = manifest.media?.contentKinds ?? [];
  const tabs = [
    ...(showsOn('media', manifest.category, kinds) ? ['Media'] : []),
    ...(showsOn('videos', manifest.category, kinds) ? ['Videos'] : []),
    ...(showsOn('tv', manifest.category, kinds) ? ['TV'] : []),
  ];
  return {
    key: 'enabled',
    label: 'Switched on',
    type: 'boolean',
    default: true,
    description: `Brings ${listKinds(kinds)} to ${tabs.join(' and ')}. Switched off, it shows nothing and asks nothing of its server.`,
  };
}

function modeField(modes: readonly PerProfile[], current: PerProfile): SelectField {
  return {
    key: 'perProfile',
    label: 'Separate config per profile',
    type: 'select',
    options: modes.map((mode) => ({ value: mode, label: PER_PROFILE_LABELS[mode] })),
    default: 'none',
    description: PER_PROFILE_DESCRIPTIONS[current],
  };
}

interface FormProps {
  title: string;
  manifest: PluginManifest;
  connectionId?: ConnectionId;
  stored?: ConnectionEditState;
  initial: ConnectionDraft;
  saved: SavedSecrets;
  submitLabel: string;
  onSubmit: (draft: ConnectionDraft) => Promise<unknown>;
  onRemove?: () => void;
}

/**
 * Built entirely from the manifest: its connection fields, the one switch every
 * connection has, and its settings. When a connection keeps values per profile,
 * profile tabs sit right above the first field that differs, and each input
 * shows whose value it is. Nothing here knows which plugin it is.
 */
function ConnectionForm({ title, manifest, connectionId, stored, initial, saved, submitLabel, onSubmit, onRemove }: FormProps) {
  const userId = useActiveUserId();
  const params = useLocalSearchParams<{ profile?: string }>();
  const { catalog, media, pins } = useServices();
  const { data: profiles = [] } = useProfiles();
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<UserId>(
    profiles.some((profile) => profile.id === params.profile) ? (params.profile as UserId) : userId,
  );
  const [unlocked, setUnlocked] = useState<ReadonlySet<UserId>>(() => new Set([userId]));
  const [pinMessage, setPinMessage] = useState<string>();
  const [errors, setErrors] = useState<DraftErrors>(NO_ERRORS);
  const [saving, setSaving] = useState(false);

  const modes = perProfileModes(manifest);
  const keys = perProfileKeys(manifest, draft.perProfile);
  const separate = draft.perProfile !== 'none';
  const tabProfile = profiles.find((profile) => profile.id === tab);
  const locked = separate && tab !== userId && tabProfile?.pinProtected === true && !unlocked.has(tab);
  const tabOff = isOffInDraft(draft, tab);
  const canProbe = catalog.mediaRole(manifest.id) !== undefined && draft.enabled;

  const target = (): ProbeTarget => {
    const values = probeValues(manifest, draft, tab);
    return {
      pluginId: manifest.id,
      ...(connectionId ? { connectionId } : {}),
      fields: values.fields,
      settings: values.settings,
      scope: values.scope,
      secrets: values.secrets,
    };
  };
  // Mutations, not queries: a secret being typed must never become a cache key.
  const test = useMutation({ mutationFn: () => media.test(target()) });
  const libraries = useMutation({ mutationFn: () => media.libraries(target()) });
  const probeReady = manifest.connectionFields.every((field) => {
    if ((field.type !== 'text' && field.type !== 'url') || !field.required) return true;
    const value = probeValues(manifest, draft, tab).fields[field.key];
    return typeof value === 'string' && value.trim() !== '';
  });
  const librariesProbe: LibrariesProbe = {
    status: !canProbe || !probeReady
      ? 'unavailable'
      : libraries.isPending
        ? 'loading'
        : libraries.isError
          ? 'error'
          : libraries.data
            ? 'ready'
            : 'idle',
    libraries: libraries.data ?? [],
    ...(libraries.error ? { error: describeProbeError(asProbeError(libraries.error)) } : {}),
    load: () => libraries.mutate(),
  };

  const selectTab = (next: UserId) => {
    setTab(next);
    setPinMessage(undefined);
    // Results belong to the account they were fetched with.
    test.reset();
    libraries.reset();
  };

  const edit = (change: (current: ConnectionDraft) => ConnectionDraft) => setDraft(change);

  const marker = (perProfile: boolean) =>
    perProfile && tabProfile ? <ProfileAvatar user={tabProfile} size={18} /> : null;

  const renderField = (field: FormField, list: ValueList, inert = false): ReactNode => {
    const perProfile = isPerProfile(manifest, draft.perProfile, list, field.key);
    const error = (perProfile ? errors.profiles[tab] : errors.shared)?.[field.key];
    if (field.type === 'password') {
      const change = secretFor(draft, tab, field.key);
      const savedHere = (separate ? saved.profiles.get(tab) : saved.shared)?.has(field.key) ?? false;
      const isSaved = change !== null && (savedHere || typeof change === 'object');
      return (
        <FieldInput
          key={`${list}.${field.key}`}
          field={field}
          value={typeof change === 'string' ? change : undefined}
          onChange={(value) => {
            if (typeof value === 'string') edit((current) => setSecret(current, tab, field.key, value));
          }}
          error={error}
          disabled={inert}
          saved={isSaved}
          marker={marker(perProfile)}
          {...(isSaved && !field.required && !inert
            ? { onRemoveSaved: () => edit((current) => setSecret(current, tab, field.key, null)) }
            : {})}
        />
      );
    }
    return (
      <FieldInput
        key={`${list}.${field.key}`}
        field={field}
        value={valueFor(manifest, draft, tab, list, field.key)}
        onChange={(value: FieldValue) => edit((current) => setValue(manifest, current, tab, list, field.key, value))}
        error={error}
        disabled={inert}
        marker={marker(perProfile)}
        {...(field.type === 'libraries' ? { libraries: librariesProbe } : {})}
      />
    );
  };

  const orderedProfiles = [...profiles].sort((a, b) => (a.id === userId ? -1 : b.id === userId ? 1 : 0));
  const tabs: SourceTab[] = orderedProfiles.map((profile) => ({
    id: profile.id,
    label: profile.name,
    ...(separate && profile.id !== userId && profile.pinProtected && !unlocked.has(profile.id)
      ? { marker: 'locked' as const }
      : isOffInDraft(draft, profile.id)
        ? { marker: 'off' as const }
        : separate && !isSetUpInDraft(manifest, draft, profile.id, saved)
          ? { marker: 'attention' as const }
          : {}),
  }));

  const profileSwitcher = separate ? (
    <ProfileSwitcher
      tabs={tabs}
      selected={tab}
      onSelect={selectTab}
      // Switching a profile off discards its details, so it needs the same PIN as changing them.
      {...(tabProfile && !locked && !tabOff ? { profile: tabProfile } : {})}
      onTurnOff={() => edit((current) => setProfileOff(current, tab, true))}
    />
  ) : null;

  const offNotice =
    tabOff && tabProfile ? (
      <YStack gap="$2" py="$2" items="flex-start">
        <SizableText size="$3" color="$color11">
          {`${tabProfile.name} doesn’t use ${draft.label.trim() || manifest.displayName}. It isn’t shown to them, and none of their details are kept.`}
        </SizableText>
        <Button size="$3" onPress={() => edit((current) => setProfileOff(current, tab, false))}>
          {`Use for ${tabProfile.name}`}
        </Button>
      </YStack>
    ) : null;

  const pinGate =
    locked && tabProfile ? (
      <YStack py="$3">
        <PinPad
          title={`Enter ${tabProfile.name}’s PIN to change their details`}
          {...(pinMessage ? { message: pinMessage, tone: 'error' as const } : {})}
          onComplete={async (pin) => {
            const check = await pins.verify(tabProfile.id, pin);
            if (check.ok) {
              setUnlocked((current) => new Set([...current, tabProfile.id]));
              setPinMessage(undefined);
            } else {
              setPinMessage(describeFailure(check));
            }
          }}
        />
      </YStack>
    ) : null;

  // The tabs sit right above the first field whose value differs per profile.
  const firstPerProfile = manifest.connectionFields.findIndex((field) => keys.fields.has(field.key));
  const before = firstPerProfile < 0 ? manifest.connectionFields : manifest.connectionFields.slice(0, firstPerProfile);
  const after = firstPerProfile < 0 ? [] : manifest.connectionFields.slice(firstPerProfile);
  const settingsOnlyPerProfile = firstPerProfile < 0 && keys.settings.size > 0;
  const ownSettings = manifest.settings.some((setting) => keys.settings.has(setting.key));

  const submit = async () => {
    const found = validateDraft(manifest, draft, saved);
    setErrors(found);
    if (hasErrors(found)) {
      const withErrors = Object.entries(found.profiles).find(([, profileErrors]) => profileErrors && hasFieldErrors(profileErrors));
      if (withErrors && !hasFieldErrors(found.shared)) selectTab(withErrors[0] as UserId);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(draft);
      router.back();
    } catch (error) {
      if (error instanceof InvalidDraftError) setErrors(error.errors);
      else setErrors({ ...NO_ERRORS, form: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  const losing = profilesLosingValues(draft, stored);
  const setUpCount = profiles.filter((profile) => isSetUpInDraft(manifest, draft, profile.id, saved)).length;
  const offNames = profiles.filter((profile) => isOffInDraft(draft, profile.id)).map((profile) => profile.name);

  return (
    <Screen>
      <Stack.Screen options={{ title }} />

      <YStack gap="$1.5">
        <Label htmlFor="connection-label" size="$3" color="$color11" fontWeight="600">
          Name
        </Label>
        <TextInput
          id="connection-label"
          value={draft.label}
          onChangeText={(label) => edit((current) => ({ ...current, label }))}
          borderColor={errors.label ? '$red8' : '$borderColor'}
        />
        {errors.label ? (
          <SizableText size="$2" color="$red10">
            {errors.label}
          </SizableText>
        ) : null}
      </YStack>

      {manifest.connectionFields.length > 0 || modes.length > 1 ? (
        <FormSection title="Connection">
          {modes.length > 1 ? (
            <FieldInput
              field={modeField(modes, draft.perProfile)}
              value={draft.perProfile}
              onChange={(value) =>
                edit((current) => switchMode(manifest, current, value as PerProfile, tab, saved))
              }
              {...(errors.form ? { error: errors.form } : {})}
            />
          ) : null}
          {before.map((field) => renderField(field, 'fields'))}
          {after.length > 0 ? profileSwitcher : null}
          {after.length > 0 ? (pinGate ?? offNotice ?? after.map((field) => renderField(field, 'fields'))) : null}
          {canProbe && !locked && !tabOff ? (
            <TestConnection test={test} ready={probeReady} displayName={manifest.displayName} />
          ) : null}
        </FormSection>
      ) : (
        <Paragraph color="$color10">Nothing to fill in — this adapter needs no details to connect.</Paragraph>
      )}

      {manifest.media ? (
        <FormSection title="Use this connection">
          <FieldInput
            field={enabledField(manifest)}
            value={draft.enabled}
            onChange={(on) => edit((current) => ({ ...current, enabled: on === true }))}
          />
        </FormSection>
      ) : null}

      {settingsOnlyPerProfile ? profileSwitcher : null}
      {settingsOnlyPerProfile ? (pinGate ?? offNotice) : null}
      {manifest.settings.length > 0 ? (
        <FormSection title="Settings">
          {locked && ownSettings ? (
            <SizableText size="$2" color="$color10">
              Enter {tabProfile?.name}’s PIN above to see their settings.
            </SizableText>
          ) : tabOff && ownSettings ? (
            <SizableText size="$2" color="$color10">
              {`Not used by ${tabProfile?.name ?? 'this profile'}.`}
            </SizableText>
          ) : (
            // Switched off, nothing it has is in effect.
            manifest.settings.map((setting) => renderField(setting, 'settings', !draft.enabled))
          )}
        </FormSection>
      ) : null}

      <Paragraph size="$2" color="$color10">
        {separate
          ? `${setUpCount} of ${profiles.length} ${profiles.length === 1 ? 'profile is' : 'profiles are'} set up${offNames.length > 0 ? `, and ${listAll(offNames)} ${offNames.length === 1 ? 'doesn’t' : 'don’t'} use it` : ''}. A profile that is not set up is asked to finish on its Media tab.`
          : manifest.media
            ? 'Shared by every profile of your account.'
            : 'Kept on this device only: another device chooses its own.'}{' '}
        Passwords are kept in secure storage and never shown again.
      </Paragraph>
      {losing > 0 ? (
        <SizableText size="$2" color="$orange10">
          Saving removes the separate details of {losing} {losing === 1 ? 'profile' : 'profiles'}.
        </SizableText>
      ) : null}

      {errors.form && modes.length <= 1 ? <SizableText color="$red10">{errors.form}</SizableText> : null}
      <YStack gap="$3" items="flex-start">
        <PrimaryButton size="$4" disabled={saving} onPress={() => void submit()}>
          {submitLabel}
        </PrimaryButton>
        {onRemove ? (
          <ConfirmButton
            label="Remove connection"
            icon={<Trash2 size={16} />}
            title={`Remove ${draft.label}?`}
            description={
              manifest.media
                ? 'Its details, and every profile’s saved password, are deleted from your account.'
                : 'Its details and saved password are deleted from this device. The backup already there stays.'
            }
            confirmLabel="Remove"
            onConfirm={onRemove}
          />
        ) : null}
      </YStack>
    </Screen>
  );
}

function ProfileSwitcher({
  tabs,
  selected,
  onSelect,
  profile,
  onTurnOff,
}: {
  tabs: readonly SourceTab[];
  selected: UserId;
  onSelect: (id: UserId) => void;
  /** The selected profile, when it may be switched off. */
  profile?: AppUser;
  onTurnOff: () => void;
}) {
  return (
    <YStack gap="$2">
      <SizableText size="$2" fontWeight="600" color="$color10" textTransform="uppercase">
        For each profile
      </SizableText>
      <SourceTabs tabs={tabs} selected={selected} onSelect={(id) => onSelect(id as UserId)} />
      {profile ? (
        <Button size="$2" chromeless color="$color10" self="flex-start" px={0} onPress={onTurnOff}>
          {`Don’t use for ${profile.name}`}
        </Button>
      ) : null}
    </YStack>
  );
}

function TestConnection({
  test,
  ready,
  displayName,
}: {
  test: UseMutationResult<SourceInfo, Error, void>;
  ready: boolean;
  displayName: string;
}) {
  return (
    <XStack gap="$3" items="center" flexWrap="wrap">
      <Button size="$3" disabled={!ready || test.isPending} onPress={() => test.mutate()}>
        Test connection
      </Button>
      {test.isPending ? <Spinner size="small" color="$accent9" /> : null}
      {test.data ? (
        <SizableText size="$2" color="$green10" flex={1}>
          {`Connected${test.data.serverName ? ` to ${test.data.serverName}` : ''} · ${displayName}${test.data.version ? ` ${test.data.version}` : ''}`}
        </SizableText>
      ) : null}
      {test.error ? (
        <SizableText size="$2" color="$red10" flex={1}>
          {describeProbeError(asProbeError(test.error))}
        </SizableText>
      ) : null}
    </XStack>
  );
}

function asProbeError(error: Error): Parameters<typeof describeProbeError>[0] {
  return isAppError(error)
    ? { code: error.code, ...(error.reason ? { reason: error.reason } : {}), message: error.message }
    : { code: 'PROVIDER_UNAVAILABLE', message: error.message };
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SettingsSection title={title}>
      <YStack p="$4" gap="$4" bg="$color2">
        {children}
      </YStack>
    </SettingsSection>
  );
}
