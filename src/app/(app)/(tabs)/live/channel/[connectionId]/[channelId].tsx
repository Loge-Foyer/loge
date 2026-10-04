import { connectionId as toConnectionId } from '@loge/api';
import { useLocalSearchParams } from 'expo-router';

import { fromRouteId } from '@/components/media/item-link';
import { ChannelGuide as ChannelGuideScreen } from '@/tabs/live';

export default function ChannelGuide() {
  const { connectionId, channelId, name, group } = useLocalSearchParams<{ connectionId: string; channelId: string; name?: string; group?: string }>();
  return (
    <ChannelGuideScreen
      channel={{ connectionId: toConnectionId(connectionId), externalId: fromRouteId(channelId) }}
      name={name ?? ''}
      {...(group ? { group: fromRouteId(group) } : {})}
    />
  );
}
