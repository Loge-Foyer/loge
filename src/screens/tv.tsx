import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { TvMinimalPlay } from '@tamagui/lucide-icons-2/icons/TvMinimalPlay';
import { Link } from 'expo-router';

import { EmptyState } from '@/components/empty-state';
import { listNames } from '@/components/labels';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { useServices } from '@/hooks/services-context';

/**
 * Live TV, and everything an IPTV provider brings — its films and series sit
 * beside its channels here, never in the library. No plugin brings channels
 * yet, so the tab shows the way to add a provider.
 */
export function TvScreen() {
  const { catalog } = useServices();
  const providers = catalog.inCategory('iptv').map((manifest) => manifest.displayName);

  // IPTV plugins leave out the platforms they cannot reach: in a browser, no provider is offered.
  if (providers.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon={<TvMinimalPlay size={26} color="$accent11" />}
          title="Live TV is in the app"
          body="IPTV providers can’t be reached from a browser. Add one in the app on your phone or tablet, and its channels, films and series appear there."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <EmptyState
        icon={<TvMinimalPlay size={26} color="$accent11" />}
        title="Live TV starts here"
        body={`Add an IPTV source in Settings → Plugins → IPTV — ${listNames(providers)} — and its channels, films and series appear here.`}
      >
        <Link href={{ pathname: '/settings/plugins/[category]', params: { category: 'iptv' } }} asChild>
          <PrimaryButton size="$4" icon={Plus}>
            Add an IPTV source
          </PrimaryButton>
        </Link>
      </EmptyState>
    </Screen>
  );
}
