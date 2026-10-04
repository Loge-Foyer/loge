import { connectionId as toConnectionId } from '@loge/api';
import { useLocalSearchParams } from 'expo-router';

import { fromRouteId } from '@/components/media/item-link';
import { TitleScreen } from '@/tabs/media';

export default function Title() {
  const { connectionId, itemId, season } = useLocalSearchParams<{ connectionId: string; itemId: string; season?: string }>();
  return (
    <TitleScreen
      itemKey={{ connectionId: toConnectionId(connectionId), externalId: fromRouteId(itemId) }}
      {...(season ? { season: fromRouteId(season) } : {})}
    />
  );
}
