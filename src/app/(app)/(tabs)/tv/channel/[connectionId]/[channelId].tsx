import { connectionId as toConnectionId } from '@sc/api';
import { useLocalSearchParams } from 'expo-router';

import { ChannelGuideScreen } from '@/screens/channel-guide';

export default function ChannelGuide() {
  const { connectionId, channelId, name, group } = useLocalSearchParams<{ connectionId: string; channelId: string; name?: string; group?: string }>();
  return (
    <ChannelGuideScreen
      channel={{ connectionId: toConnectionId(connectionId), externalId: channelId }}
      name={name ?? ''}
      {...(group ? { group } : {})}
    />
  );
}
