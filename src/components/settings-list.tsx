import { ChevronRight } from '@tamagui/lucide-icons-2/icons/ChevronRight';
import { Link, type Href } from 'expo-router';
import { Children, Fragment, type ReactNode } from 'react';
import { ListItem, Separator, SizableText, YGroup, YStack } from 'tamagui';

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
      {title ? (
        <SizableText size="$2" fontWeight="600" color="$color10" px="$3" textTransform="uppercase">
          {title}
        </SizableText>
      ) : null}
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

export function SettingsRow({ title, subtitle, icon, trailing, href, onPress, destructive, disabled }: RowProps) {
  const navigates = href !== undefined;
  const item = (
    <ListItem
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
        <SizableText size="$4" color={destructive ? '$red10' : '$color12'} fontWeight="500">
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
    </ListItem>
  );
  return href !== undefined ? (
    <Link href={href} asChild>
      {item}
    </Link>
  ) : (
    item
  );
}
