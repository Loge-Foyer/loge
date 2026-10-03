import { ChevronRight } from '@tamagui/lucide-icons-2/icons/ChevronRight';
import { Link, type Href } from 'expo-router';
import { Children, Fragment, type ReactNode } from 'react';
import { ListItem, Separator, SizableText, XStack, YGroup, YStack } from 'tamagui';

import { px } from '@/components/density';
import { Button } from '@/components/button';
import { remotely } from '@/components/remote';

/** A group's name above it, as every section of Settings has one. */
export function SectionTitle({ children }: { children: string }) {
  return (
    <SizableText size="$2" fontWeight="600" color="$color10" px="$3" textTransform="uppercase">
      {children}
    </SizableText>
  );
}

export function SettingsSection({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
}) {
  const rows = Children.toArray(children);
  return (
    <YStack gap="$2">
      {title ? <SectionTitle>{title}</SectionTitle> : null}
      <YGroup rounded="$6" overflow="hidden" borderWidth={1} borderColor="$borderColor">
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index > 0 ? <Separator borderColor="$borderColor" /> : null}
            <YGroup.Item>{row}</YGroup.Item>
          </Fragment>
        ))}
      </YGroup>
      {footer ? (
        <SizableText size="$2" color="$color10" px="$3">
          {footer}
        </SizableText>
      ) : null}
    </YStack>
  );
}

interface RowProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  /** Shown at the trailing edge, e.g. a switch or a value. */
  trailing?: ReactNode;
  href?: Href;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

// A row a TV remote can press too; focused, it lights up in the accent.
const Row = remotely(ListItem, { bg: '$accent4' });

export function SettingsRow({ title, subtitle, icon, trailing, href, onPress, destructive, disabled }: RowProps) {
  const navigates = href !== undefined;
  const item = (
    <Row
      bg="$color2"
      hoverStyle={{ bg: '$color3' }}
      pressStyle={{ bg: '$color4' }}
      disabled={disabled}
      opacity={disabled ? 0.5 : 1}
      gap="$3"
      // A pressable row is a button to assistive tech and the keyboard as well.
      {...(onPress ? { onPress, role: 'button' as const, tabIndex: 0 } : {})}
    >
      {icon}
      <YStack flex={1} gap="$0.5">
        <SizableText size="$4" color={destructive ? '$red11' : '$color12'} fontWeight="500">
          {title}
        </SizableText>
        {subtitle ? (
          <SizableText size="$2" color="$color10" numberOfLines={2}>
            {subtitle}
          </SizableText>
        ) : null}
      </YStack>
      {trailing}
      {navigates ? <ChevronRight size={18} color="$color9" /> : null}
    </Row>
  );
  return href !== undefined ? (
    <Link href={href} asChild>
      {item}
    </Link>
  ) : (
    item
  );
}

/** A row whose trailing edge is a short list of choices, one of them taken. */
export function ChoiceRow<T extends string | number>({
  title,
  subtitle,
  options,
  label,
  value,
  disabled,
  onChoose,
}: {
  title: string;
  subtitle?: string;
  options: readonly T[];
  label: (option: T) => string;
  value: T;
  disabled: boolean;
  onChoose: (option: T) => void;
}) {
  return (
    <SettingsRow
      title={title}
      {...(subtitle ? { subtitle } : {})}
      trailing={
        <XStack gap="$1" flexWrap="wrap" justify="flex-end" maxW={px(240)}>
          {options.map((option) => (
            <Button
              key={String(option)}
              size="$2"
              aria-label={`${title}: ${label(option)}`}
              disabled={disabled}
              {...(option === value ? ({ theme: 'accent' } as const) : {})}
              onPress={() => onChoose(option)}
            >
              <Button.Text>{label(option)}</Button.Text>
            </Button>
          ))}
        </XStack>
      }
    />
  );
}
