import { isLibrarySelection, type FieldValue, type LibrariesField as LibrariesDescriptor, type Library, type LibrarySelection } from '@sc/api';
import { RefreshCw } from '@tamagui/lucide-icons-2/icons/RefreshCw';
import { Paragraph, SizableText, Spinner, XStack, YStack } from 'tamagui';

import { Button } from '@/components/button';
import { AppSwitch } from '@/components/app-switch';
import { Chip, ChipRow } from '@/components/chip';
import { CONTENT_KIND_LABELS } from '@/components/labels';
import { SourceTabs } from '@/components/source-tabs';

/** The libraries a connection reports, fetched only when asked — asking means signing in. */
export interface LibrariesProbe {
  readonly status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
  readonly libraries: readonly Library[];
  readonly error?: string;
  load(): void;
}

const MODES = [
  { id: 'all', label: 'All' },
  { id: 'only', label: 'Only these' },
  { id: 'except', label: 'All except these' },
] as const;

/**
 * A choice among a source's own libraries. The list is only fetched on
 * request: a password still being typed must never be tried against the
 * server, which may lock the account after a few failures.
 */
export function LibrariesField({
  field,
  value,
  onChange,
  disabled,
  probe,
}: {
  field: LibrariesDescriptor;
  value: FieldValue | undefined;
  onChange: (value: LibrarySelection) => void;
  disabled: boolean;
  probe?: LibrariesProbe;
}) {
  const selection = isLibrarySelection(value) ? value : field.default;
  const ids = selection.mode === 'all' ? [] : selection.ids;

  const setMode = (mode: LibrarySelection['mode']) =>
    onChange(mode === 'all' ? { mode } : { mode, ids: selection.mode === 'all' ? [] : selection.ids });
  const toggle = (id: string, on: boolean) => {
    if (selection.mode === 'all') return;
    onChange({ mode: selection.mode, ids: on ? [...ids, id] : ids.filter((candidate) => candidate !== id) });
  };

  const known = new Set(probe?.libraries.map((library) => library.id));
  const unavailable = ids.filter((id) => !known.has(id));

  return (
    <YStack gap="$3" opacity={disabled ? 0.5 : 1} pointerEvents={disabled ? 'none' : 'auto'}>
      <SourceTabs tabs={MODES} selected={selection.mode} onSelect={(mode) => setMode(mode as LibrarySelection['mode'])} />
      {selection.mode === 'all' ? (
        <SizableText size="$2" color="$color10">
          Every library the server has, including ones added later.
        </SizableText>
      ) : !probe || probe.status === 'unavailable' ? (
        <Paragraph size="$2" color="$color10">
          Fill in the connection details above to choose libraries.
        </Paragraph>
      ) : probe.status === 'idle' ? (
        <XStack gap="$3" items="center">
          <Button size="$3" onPress={probe.load}>
            Load libraries
          </Button>
          <SizableText size="$2" color="$color10" flex={1}>
            Signs in to the server to list them.
          </SizableText>
        </XStack>
      ) : probe.status === 'loading' ? (
        <XStack gap="$2" items="center">
          <Spinner size="small" color="$accent9" />
          <SizableText size="$2" color="$color10">
            Asking the server for its libraries…
          </SizableText>
        </XStack>
      ) : probe.status === 'error' ? (
        <XStack gap="$3" items="center">
          <SizableText size="$2" color="$red10" flex={1}>
            {probe.error}
          </SizableText>
          <Button size="$3" icon={RefreshCw} onPress={probe.load}>
            Try again
          </Button>
        </XStack>
      ) : (
        <YStack rounded="$5" borderWidth={1} borderColor="$borderColor" overflow="hidden">
          {probe.libraries.map((library, index) => (
            <XStack
              key={library.id}
              px="$3"
              py="$2.5"
              gap="$3"
              items="center"
              borderTopWidth={index === 0 ? 0 : 1}
              borderColor="$borderColor"
              bg="$color1"
            >
              <YStack flex={1} gap="$1">
                <SizableText size="$4" color="$color12">
                  {library.name}
                </SizableText>
                <ChipRow>
                  {library.kinds.map((kind) => (
                    <Chip key={kind} label={CONTENT_KIND_LABELS[kind]} />
                  ))}
                </ChipRow>
              </YStack>
              <AppSwitch
                label={library.name}
                checked={ids.includes(library.id)}
                onCheckedChange={(on) => toggle(library.id, on)}
              />
            </XStack>
          ))}
          {probe.libraries.length === 0 ? (
            <SizableText size="$2" color="$color10" p="$3">
              The server reports no film or series libraries.
            </SizableText>
          ) : null}
        </YStack>
      )}
      {unavailable.length > 0 && probe?.status === 'ready' ? (
        <SizableText size="$2" color="$color10">
          {unavailable.length === 1 ? 'One chosen library is' : `${unavailable.length} chosen libraries are`} no longer on
          the server; they are kept in case it comes back.
        </SizableText>
      ) : null}
    </YStack>
  );
}
