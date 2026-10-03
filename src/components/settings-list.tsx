import type { Credit } from '@loge/api';
import { ChevronRight } from '@tamagui/lucide-icons-2/icons/ChevronRight';
import { ExternalLink } from '@tamagui/lucide-icons-2/icons/ExternalLink';
import { Github } from '@tamagui/lucide-icons-2/icons/Github';
import { Globe } from '@tamagui/lucide-icons-2/icons/Globe';
import { Link, type Href } from 'expo-router';
import { Children, Fragment, type ReactNode } from 'react';
import { Linking } from 'react-native';
import { ListItem, Separator, SizableText, XStack, YGroup, YStack } from 'tamagui';

import { px } from '@/components/density';
import { Button } from '@/components/button';
import { isTV, remotely } from '@/components/remote';

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
  /** What a press does, to assistive tech: a button unless it opens an address. */
  role?: 'button' | 'link';
  /** How many lines the subtitle may take. */
  subtitleLines?: number;
  destructive?: boolean;
  disabled?: boolean;
}

// A row a TV remote can press too; focused, it lights up in the accent.
const Row = remotely(ListItem, { bg: '$accent4' });

export function SettingsRow({ title, subtitle, icon, trailing, href, onPress, role = 'button', subtitleLines = 2, destructive, disabled }: RowProps) {
  const navigates = href !== undefined;
  const item = (
    <Row
      bg="$color2"
      hoverStyle={{ bg: '$color3' }}
      pressStyle={{ bg: '$color4' }}
      disabled={disabled}
      opacity={disabled ? 0.5 : 1}
      gap="$3"
      // A pressable row is a button — or a link — to assistive tech and the keyboard as well.
      {...(onPress ? { onPress, role, tabIndex: 0 } : {})}
    >
      {icon}
      <YStack flex={1} gap="$0.5">
        <SizableText size="$4" color={destructive ? '$red11' : '$color12'} fontWeight="500">
          {title}
        </SizableText>
        {subtitle ? (
          <SizableText size="$2" color="$color10" numberOfLines={subtitleLines}>
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

/** An address as it is read aloud or typed: no scheme, no closing slash. */
const readable = (url: string) => url.replace(/^https:\/\//, '').replace(/\/$/, '');

// A TV has no browser to open an address in: the row shows it instead, and
// still takes the remote's focus, which scrolls only as far as something it
// can land on.
const stayPut = () => undefined;

/**
 * A way out to an address — an upstream project, a service's site — drawn
 * like any row: GitHub's mark for a repository there, a globe for anything
 * else, chosen by the address and never by a plugin; what it is, the address
 * beneath, and a link symbol at the far end, so it reads as something to
 * press. React Native's `Linking` opens it: a new tab in a browser, where
 * expo-linking would take the app itself away.
 */
export function LinkRow({ title, url, note }: { title: string; url: string; note?: string }) {
  const Mark = url.startsWith('https://github.com/') ? Github : Globe;
  return (
    <SettingsRow
      title={title}
      subtitle={note ? `${note}\n${readable(url)}` : readable(url)}
      subtitleLines={4}
      icon={<Mark size={20} color="$color11" />}
      role="link"
      onPress={isTV ? stayPut : () => void Linking.openURL(url).catch(() => undefined)}
      {...(isTV ? {} : { trailing: <ExternalLink size={18} color="$color9" /> })}
    />
  );
}

/** What a plugin is built on, from its manifest. */
export function CreditRow({ credit }: { credit: Credit }) {
  return <LinkRow title={credit.name} url={credit.url} {...(credit.note ? { note: credit.note } : {})} />;
}

/**
 * The option taken, among the ones beside it: the accent's fill, as a chosen
 * tab has. Not Tamagui's `accent` theme, whose page colour it would take — a
 * cream paler than an unchosen button in light, a brown darker than one in
 * the dark.
 */
export const CHOSEN = { bg: '$accentBackground', color: '$accentColor' } as const;

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
              {...(option === value ? CHOSEN : {})}
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
