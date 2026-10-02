import type { Field, FieldValue, PluginSettingDescriptor } from '@loge/api';
import { Check } from '@tamagui/lucide-icons-2/icons/Check';
import { ChevronDown } from '@tamagui/lucide-icons-2/icons/ChevronDown';
import { ChevronUp } from '@tamagui/lucide-icons-2/icons/ChevronUp';
import { useId, useState, type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Adapt, Label, Select, Sheet, SizableText, XStack, YStack } from 'tamagui';

import { Button } from '@/components/button';
import { AppSwitch } from '@/components/app-switch';
import { TextInput } from '@/components/text-input';

import { LibrariesField, type LibrariesProbe } from './libraries-field';

export type FormField = Field | PluginSettingDescriptor;

export interface FieldInputProps {
  field: FormField;
  /** For a password field: what was typed in this edit — never a saved value, unless the field is `visible`. */
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  error?: string | undefined;
  disabled?: boolean;
  /** A password field that already holds a saved value. */
  saved?: boolean;
  /** Offered for an optional password field that holds a saved value. */
  onRemoveSaved?: () => void;
  /** Shown beside the label — whose value this is, when values differ per profile. */
  marker?: ReactNode;
  /** For a `libraries` field: the libraries the connection reports. */
  libraries?: LibrariesProbe;
}

/**
 * Renders one declared field. It switches on the field's type and nothing
 * else — no plugin is ever named here, so a new plugin needs no new form.
 */
export function FieldInput(props: FieldInputProps) {
  const { field, error, marker } = props;
  const id = useId();

  if (field.type === 'boolean') return <ToggleField {...props} field={field} id={id} />;

  return (
    <YStack gap="$1.5">
      <XStack items="center" gap="$2">
        <Label htmlFor={id} size="$3" lineHeight="$3" color="$color11" fontWeight="600">
          {field.label}
          {'required' in field && field.required ? ' *' : ''}
        </Label>
        {marker}
      </XStack>
      {field.type === 'select' ? (
        <SelectField {...props} field={field} id={id} />
      ) : field.type === 'libraries' ? (
        <LibrariesField
          field={field}
          value={props.value}
          onChange={props.onChange}
          disabled={props.disabled ?? false}
          {...(props.libraries ? { probe: props.libraries } : {})}
        />
      ) : (
        <TextInputField {...props} id={id} />
      )}
      {error ? (
        <SizableText size="$2" color="$red10">
          {error}
        </SizableText>
      ) : field.description ? (
        <SizableText size="$2" color="$color10">
          {field.description}
        </SizableText>
      ) : null}
    </YStack>
  );
}

function TextInputField({ field, value, onChange, disabled, saved, onRemoveSaved, error, id }: FieldInputProps & { id: string }) {
  const isPassword = field.type === 'password';
  // A visible password is typed and read in the clear: stored as a secret, shown as text.
  const masked = isPassword && field.visible !== true;
  const placeholder = isPassword && saved ? 'Saved — type to replace' : 'placeholder' in field ? field.placeholder : undefined;
  return (
    <XStack gap="$2" items="center">
      <TextInput
        id={id}
        flex={1}
        size="$4"
        value={typeof value === 'string' ? value : ''}
        onChangeText={onChange}
        disabled={disabled}
        opacity={disabled ? 0.6 : 1}
        borderColor={error ? '$red8' : '$borderColor'}
        autoCapitalize="none"
        autoCorrect={false}
        // `type` alone: on native it picks the keyboard or masks the text, as
        // long as no inputMode/keyboardType overrides it.
        type={masked ? 'password' : field.type === 'url' ? 'url' : 'text'}
        {...(placeholder ? { placeholder } : {})}
      />
      {isPassword && saved && onRemoveSaved ? (
        <Button size="$3" chromeless color="$red10" onPress={onRemoveSaved}>
          Remove
        </Button>
      ) : null}
    </XStack>
  );
}

function ToggleField({
  field,
  value,
  onChange,
  disabled,
  marker,
  id,
}: FieldInputProps & { field: Extract<FormField, { type: 'boolean' }>; id: string }) {
  const checked = typeof value === 'boolean' ? value : field.default;
  return (
    <XStack gap="$3" items="center" justify="space-between">
      <YStack flex={1} gap="$0.5">
        <XStack items="center" gap="$2">
          {/* Label lines up with a control's height by default; a toggle's label
              may wrap, so it takes the font's own line height. */}
          <Label htmlFor={id} size="$4" lineHeight="$4" color={disabled ? '$color9' : '$color12'}>
            {field.label}
          </Label>
          {marker}
        </XStack>
        {field.description ? (
          <SizableText size="$2" color="$color10">
            {field.description}
          </SizableText>
        ) : null}
      </YStack>
      <AppSwitch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled ?? false} />
    </XStack>
  );
}

/** More than fits a sheet of options — every time zone — is chosen by typing some of it. */
const LONG_LIST = 12;
/** As many matches as a screen holds; typing narrows the rest. */
const SHOWN_MATCHES = 40;

function SelectField(props: FieldInputProps & { field: Extract<FormField, { type: 'select' }>; id: string }) {
  return props.field.options.length > LONG_LIST ? <FilteredSelect {...props} /> : <ShortSelect {...props} />;
}

/**
 * A long list as a filter box over its matches, drawn in place: no portal,
 * so it works inside a native sheet, with a TV remote and in a browser alike.
 */
function FilteredSelect({
  field,
  value,
  onChange,
  disabled,
  id,
}: FieldInputProps & { field: Extract<FormField, { type: 'select' }>; id: string }) {
  const current = typeof value === 'string' ? value : field.default;
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const chosen = field.options.find((option) => option.value === current);
  const wanted = filter.trim().toLowerCase();
  const matches =
    wanted === '' ? field.options : field.options.filter((option) => option.label.toLowerCase().includes(wanted) || option.value.toLowerCase().includes(wanted));
  const shown = matches.slice(0, SHOWN_MATCHES);
  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setFilter('');
  };
  return (
    <YStack gap="$2">
      <Button
        id={id}
        size="$4"
        justify="space-between"
        iconAfter={open ? ChevronUp : ChevronDown}
        disabled={disabled ?? false}
        aria-expanded={open}
        onPress={() => setOpen(!open)}
      >
        {chosen?.label ?? current}
      </Button>
      {open ? (
        <YStack gap="$1" p="$2" rounded="$4" borderWidth={1} borderColor="$borderColor">
          <TextInput
            value={filter}
            onChangeText={setFilter}
            placeholder="Type to find one"
            aria-label={`Find a ${field.label.toLowerCase()}`}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {shown.map((option) => (
            <Button
              key={option.value}
              size="$3"
              chromeless
              justify="flex-start"
              aria-selected={option.value === current}
              {...(option.value === current ? { icon: Check } : {})}
              onPress={() => choose(option.value)}
            >
              {option.label}
            </Button>
          ))}
          {matches.length === 0 ? (
            <SizableText size="$2" color="$color10" px="$2">
              Nothing matches that.
            </SizableText>
          ) : matches.length > shown.length ? (
            <SizableText size="$2" color="$color10" px="$2">
              {`${matches.length - shown.length} more — type to narrow them down.`}
            </SizableText>
          ) : null}
        </YStack>
      ) : null}
    </YStack>
  );
}

function ShortSelect({
  field,
  value,
  onChange,
  disabled,
  id,
}: FieldInputProps & { field: Extract<FormField, { type: 'select' }>; id: string }) {
  const current = typeof value === 'string' ? value : field.default;
  const { bottom } = useSafeAreaInsets();
  return (
    <Select id={id} value={current} onValueChange={onChange} disablePreventBodyScroll>
      <Select.Trigger
        width="100%"
        size="$4"
        rounded="$4"
        borderWidth={1}
        borderColor="$borderColor"
        iconAfter={ChevronDown}
        disabled={disabled ?? false}
      >
        <Select.Value placeholder={field.label} />
      </Select.Trigger>

      {/* Select only works on touch devices adapted to a sheet. */}
      <Adapt when="max-md" platform="touch">
        <Sheet modal dismissOnSnapToBottom snapPointsMode="fit">
          {/* Clear the home indicator / gesture bar under the last option. */}
          <Sheet.Frame pb={bottom}>
            <Sheet.ScrollView>
              <Adapt.Contents />
            </Sheet.ScrollView>
          </Sheet.Frame>
          <Sheet.Overlay bg="$shadowColor" enterStyle={{ opacity: 0 }} exitStyle={{ opacity: 0 }} />
        </Sheet>
      </Adapt>

      <Select.Content>
        <Select.Viewport minW={220}>
          <Select.Group>
            {field.options.map((option, index) => (
              <Select.Item key={option.value} index={index} value={option.value}>
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator ml="auto">
                  <Check size={16} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Group>
        </Select.Viewport>
      </Select.Content>
    </Select>
  );
}
