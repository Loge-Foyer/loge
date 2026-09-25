import {
  declaredRoles,
  defaultRoles,
  type BooleanField,
  type Connection,
  type ConnectionId,
  type ConnectionOwner,
  type FieldValue,
  type PluginId,
  type PluginManifest,
  type PluginRole,
  type PluginSettingDescriptor,
} from '@sc/api';
import { Trash2 } from '@tamagui/lucide-icons-2/icons/Trash2';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Label, Paragraph, SizableText, YStack } from 'tamagui';

import { ConfirmButton } from '@/components/confirm-button';
import { listKinds } from '@/components/labels';
import { FieldInput, FieldList } from '@/components/manifest-form';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { SettingsSection } from '@/components/settings-list';
import { TextInput } from '@/components/text-input';
import { useConnection, useConnectionActions, usePluginConnections } from '@/hooks/use-connections';
import { usePluginManifest } from '@/hooks/use-plugins';
import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';
import { InvalidDraftError, type ConnectionDraft } from '@/services/connections';
import { defaultValues, hasErrors, validateDraft, type FieldErrors } from '@/services/field-values';
import { kindsForTab } from '@/services/tab-content';

export function NewConnectionScreen({ pluginId }: { pluginId: PluginId }) {
  const manifest = usePluginManifest(pluginId);
  const { data: live } = usePluginConnections(pluginId);
  const { create } = useConnectionActions();
  if (!manifest || !live) return <Missing loading={!!manifest} />;

  const count = live.connections.length;
  const initial: ConnectionDraft = {
    label: count === 0 ? manifest.displayName : `${manifest.displayName} ${count + 1}`,
    roles: defaultRoles(manifest),
    fields: defaultValues(manifest.connectionFields),
    secrets: {},
    settings: defaultValues(manifest.settings),
  };
  return (
    <ConnectionForm
      title={`New ${manifest.displayName} connection`}
      manifest={manifest}
      owner={live.owner}
      initial={initial}
      savedSecrets={new Set()}
      submitLabel="Add connection"
      onSubmit={(draft) => create.mutateAsync({ pluginId, owner: live.owner, draft })}
    />
  );
}

export function EditConnectionScreen({ connectionId }: { connectionId: ConnectionId }) {
  const { data } = useConnection(connectionId);
  const manifest = usePluginManifest((data?.connection.pluginId ?? '') as PluginId);
  const { update, remove } = useConnectionActions();
  if (data === undefined) return <Missing loading />;
  if (data === null || !manifest) return <Missing loading={false} />;

  const { connection, savedSecrets } = data;
  return (
    <ConnectionForm
      title={connection.label}
      manifest={manifest}
      owner={connection.owner}
      initial={draftOf(manifest, connection)}
      savedSecrets={savedSecrets}
      submitLabel="Save"
      onSubmit={(draft) => update.mutateAsync({ id: connection.id, draft })}
      onRemove={() => remove.mutate(connection.id, { onSuccess: () => router.back() })}
    />
  );
}

function draftOf(manifest: PluginManifest, connection: Connection): ConnectionDraft {
  // Defaults first, so a field or setting the plugin added since shows its default.
  return {
    label: connection.label,
    roles: connection.roles,
    fields: { ...defaultValues(manifest.connectionFields), ...connection.fields },
    secrets: {},
    settings: { ...defaultValues(manifest.settings), ...connection.settings },
  };
}

function Missing({ loading }: { loading: boolean }) {
  return (
    <Screen>{loading ? null : <SizableText color="$color10">This connection no longer exists.</SizableText>}</Screen>
  );
}

const ROLE_FIELDS: Readonly<Record<PluginRole, (manifest: PluginManifest) => BooleanField>> = {
  media: (manifest) => {
    const kinds = manifest.media?.contentKinds ?? [];
    const tabs = [
      ...(kindsForTab('media', kinds).length > 0 ? ['Media'] : []),
      ...(kindsForTab('videos', kinds).length > 0 ? ['Videos'] : []),
    ];
    return {
      key: 'role.media',
      label: 'Use as a media source',
      type: 'boolean',
      default: false,
      description: `Brings ${listKinds(kinds)} to ${tabs.join(' and ')}.`,
    };
  },
  sync: (manifest) => ({
    key: 'role.sync',
    label: 'Keep my state here',
    type: 'boolean',
    default: false,
    description:
      (manifest.sync?.capabilities.length ?? 0) > 0
        ? 'Only what you switch on below is sent.'
        : 'Nothing to sync yet — this plugin cannot carry any state so far.',
  }),
};

/** Which role a setting belongs to: the role of what it gates, if anything. */
function roleOf(setting: PluginSettingDescriptor): PluginRole | null {
  const gate = setting.type === 'boolean' ? setting.gates?.[0] : undefined;
  if (!gate) return null;
  return gate.startsWith('sync.') ? 'sync' : 'media';
}

interface FormProps {
  title: string;
  manifest: PluginManifest;
  owner: ConnectionOwner;
  initial: ConnectionDraft;
  savedSecrets: ReadonlySet<string>;
  submitLabel: string;
  onSubmit: (draft: ConnectionDraft) => Promise<unknown>;
  onRemove?: () => void;
}

/**
 * Built entirely from the manifest: its connection fields, one switch per role
 * it declares, and its settings. Nothing here knows which plugin it is.
 */
function ConnectionForm({ title, manifest, owner, initial, savedSecrets, submitLabel, onSubmit, onRemove }: FormProps) {
  const userId = useActiveUserId();
  const profile = useProfiles().data?.find((candidate) => candidate.id === userId);
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const secretKeys = new Set(
    manifest.connectionFields.filter((field) => field.type === 'password').map((field) => field.key),
  );
  const connectionValues: Record<string, FieldValue | null> = { ...draft.fields };
  for (const key of secretKeys) {
    const change = draft.secrets[key];
    if (change !== undefined) connectionValues[key] = change;
    else delete connectionValues[key];
  }

  const setField = (key: string, value: FieldValue) =>
    setDraft((current) =>
      secretKeys.has(key) && typeof value === 'string'
        ? { ...current, secrets: { ...current.secrets, [key]: value } }
        : { ...current, fields: { ...current.fields, [key]: value } },
    );
  const removeSecret = (key: string) =>
    setDraft((current) => ({ ...current, secrets: { ...current.secrets, [key]: null } }));
  const setSetting = (key: string, value: FieldValue) =>
    setDraft((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  const setRole = (role: PluginRole, on: boolean) =>
    setDraft((current) => ({ ...current, roles: { ...current.roles, [role]: on } }));

  const submit = async () => {
    const found = validateDraft(manifest, draft, savedSecrets);
    setErrors(found);
    if (hasErrors(found)) return;
    setSaving(true);
    try {
      await onSubmit(draft);
      router.back();
    } catch (error) {
      if (error instanceof InvalidDraftError) setErrors(error.errors);
      else setErrors({ form: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  const groups = [
    { role: null, title: 'Settings' },
    { role: 'media', title: 'Media settings' },
    { role: 'sync', title: 'What to sync' },
  ] as const;

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
          onChangeText={(label) => setDraft((current) => ({ ...current, label }))}
          borderColor={errors.label ? '$red8' : '$borderColor'}
        />
        {errors.label ? (
          <SizableText size="$2" color="$red10">
            {errors.label}
          </SizableText>
        ) : null}
      </YStack>

      {manifest.connectionFields.length > 0 ? (
        <FormSection title="Connection">
          <FieldList
            fields={manifest.connectionFields}
            values={connectionValues}
            errors={errors}
            onChange={setField}
            savedSecrets={savedSecrets}
            onRemoveSaved={removeSecret}
          />
        </FormSection>
      ) : (
        <Paragraph color="$color10">Nothing to fill in — this plugin needs no details to connect.</Paragraph>
      )}

      <FormSection title="Use this connection">
        {declaredRoles(manifest).map((role) => (
          <FieldInput
            key={role}
            field={ROLE_FIELDS[role](manifest)}
            value={draft.roles[role] === true}
            onChange={(on) => setRole(role, on === true)}
          />
        ))}
      </FormSection>

      {groups.map(({ role, title: groupTitle }) => {
        const settings = manifest.settings.filter((setting) => roleOf(setting) === role);
        if (settings.length === 0) return null;
        const inert = role !== null && draft.roles[role] !== true;
        return (
          <FormSection key={groupTitle} title={groupTitle}>
            <FieldList
              fields={settings}
              values={draft.settings}
              errors={errors}
              onChange={setSetting}
              disabled={inert}
            />
          </FormSection>
        );
      })}

      <Paragraph size="$2" color="$color10">
        {owner.scope === 'device'
          ? 'Shared by every profile on this device.'
          : `Only ${profile?.name ?? 'this profile'} uses this connection.`}{' '}
        Passwords are kept in secure storage and never shown again.
      </Paragraph>

      {errors.form ? <SizableText color="$red10">{errors.form}</SizableText> : null}
      <YStack gap="$3" items="flex-start">
        <PrimaryButton size="$4" disabled={saving} onPress={() => void submit()}>
          {submitLabel}
        </PrimaryButton>
        {onRemove ? (
          <ConfirmButton
            label="Remove connection"
            icon={<Trash2 size={16} />}
            title={`Remove ${draft.label}?`}
            description="Its details and saved password are deleted from this device."
            confirmLabel="Remove"
            onConfirm={onRemove}
          />
        ) : null}
      </YStack>
    </Screen>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SettingsSection title={title}>
      <YStack p="$4" gap="$4" bg="$color2">
        {children}
      </YStack>
    </SettingsSection>
  );
}
