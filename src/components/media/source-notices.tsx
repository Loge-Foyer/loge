import { RefreshCw } from '@tamagui/lucide-icons-2/icons/RefreshCw';
import { WifiOff } from '@tamagui/lucide-icons-2/icons/WifiOff';
import { Button, SizableText, XStack, YStack } from 'tamagui';

import { describeSourceError } from '@/components/labels';
import type { SourceError } from '@/services/media';

/** Quiet lines for the sources that could not answer, beside whatever did arrive. */
export function SourceNotices({ errors, onRetry }: { errors: readonly SourceError[]; onRetry?: () => void }) {
  if (errors.length === 0) return null;
  // One line per source, however many rows it failed in.
  const unique = [...new Map(errors.map((error) => [error.connectionId, error])).values()];
  return (
    <YStack gap="$1.5">
      {unique.map((error) => (
        <XStack key={error.connectionId} gap="$2" items="center">
          <WifiOff size={14} color="$color9" />
          <SizableText size="$2" color="$color10" flex={1}>
            {describeSourceError(error)}
          </SizableText>
          {onRetry && error.retry !== 'never' ? (
            <Button size="$2" chromeless icon={RefreshCw} color="$color10" onPress={onRetry} aria-label="Try again">
              Retry
            </Button>
          ) : null}
        </XStack>
      ))}
    </YStack>
  );
}
