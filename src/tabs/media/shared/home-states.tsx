import type { PerProfile } from '@loge/api';
import { Film } from '@tamagui/lucide-icons-2/icons/Film';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { Link } from 'expo-router';
import { SizableText, XStack, YStack } from 'tamagui';

import { EmptyState } from '@/components/empty-state';
import { listKinds, listNames } from '@/components/labels';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { useServices } from '@/hooks/services-context';
import { useActiveUserId } from '@/hooks/use-session';
import { categoryHref } from '@/screens/settings/plugin-route';
import { TAB_CONTENT } from '@/services/tab-content';

export interface PendingConnection {
  readonly id: string;
  readonly label: string;
  readonly perProfile: PerProfile;
}

export function SetUpCallout({ connection }: { connection: PendingConnection }) {
  const userId = useActiveUserId();
  return (
    <XStack gap="$3" items="center" p="$3" rounded="$6" bg="$accent2" borderWidth={1} borderColor="$accent5">
      <SizableText size="$3" color="$color12" flex={1}>
        {connection.perProfile === 'credentials'
          ? `${connection.label} needs your own sign-in.`
          : `${connection.label} needs your own details.`}
      </SizableText>
      <Link
        href={{ pathname: '/settings/connections/[connectionId]', params: { connectionId: connection.id, profile: userId } }}
        asChild
      >
        <PrimaryButton size="$3">Finish setting up</PrimaryButton>
      </Link>
    </XStack>
  );
}

export function SetUpScreen({ pending }: { pending: readonly { connection: PendingConnection }[] }) {
  return (
    <Screen>
      <EmptyState
        icon={<Film size={26} color="$accent11" />}
        title="Almost there"
        body={
          pending.length === 1
            ? 'This source keeps separate details for each profile. Add yours to see its library.'
            : 'These sources keep separate details for each profile. Add yours to see their libraries.'
        }
      >
        <YStack gap="$3" width="100%">
          {pending.map(({ connection }) => (
            <SetUpCallout key={connection.id} connection={connection} />
          ))}
        </YStack>
      </EmptyState>
    </Screen>
  );
}

export function MediaEmptyState() {
  const { catalog } = useServices();
  const names = catalog.showingOn('media').map((manifest) => manifest.displayName);
  return (
    <Screen>
      <EmptyState
        icon={<Film size={26} color="$accent11" />}
        title="Your library starts here"
        body={`Connect a source that brings ${listKinds(TAB_CONTENT.media)}${names.length > 0 ? ` — ${listNames(names)}` : ''}. Films and series from all of them share one library.`}
      >
        <Link href={categoryHref('sources')} asChild>
          <PrimaryButton size="$4" icon={Plus}>
            Add a source
          </PrimaryButton>
        </Link>
      </EmptyState>
      <SizableText size="$2" color="$color9">
        Sources belong to your account, and every profile sees them — unless a connection keeps a separate sign-in
        for each profile.
      </SizableText>
    </Screen>
  );
}
