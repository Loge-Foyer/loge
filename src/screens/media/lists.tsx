import type { GlobalMediaKey, MediaItem } from '@sc/api';
import { ListMusic } from '@tamagui/lucide-icons-2/icons/ListMusic';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { Rss } from '@tamagui/lucide-icons-2/icons/Rss';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Paragraph, SizableText, XStack, YStack } from 'tamagui';

import { Button } from '@/components/button';
import { ConfirmButton } from '@/components/confirm-button';
import { EmptyState } from '@/components/empty-state';
import { episodeCode } from '@/components/labels';
import { keyHref } from '@/components/media/item-link';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { TextInput } from '@/components/text-input';
import { useListActions, usePlaylists, useSubscriptions } from '@/hooks/use-lists';
import { useItem } from '@/hooks/use-media';

/**
 * What this profile keeps for itself: the channels it follows, and the lists
 * it made. Account-wide, so it is the same on every device signed in.
 */
export function ListsScreen() {
  const { data: subscriptions = [] } = useSubscriptions();
  const { data: playlists = [] } = usePlaylists();
  const { create, remove, unfollow, removeItem } = useListActions();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const make = () => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    create.mutate(trimmed);
    setName('');
    setNaming(false);
  };

  return (
    <Screen gap="$6">
      <Stack.Screen options={{ title: 'Your lists' }} />

      <SettingsSection
        title={subscriptions.length === 1 ? 'Following 1 channel' : `Following ${subscriptions.length} channels`}
        footer="Their newest appears on Videos. Following goes with your account, so every device you sign in to has it."
      >
        {subscriptions.length === 0 ? (
          <SettingsRow title="Nothing followed yet" subtitle="Open a channel and choose Follow." disabled />
        ) : (
          subscriptions.map((subscription) => (
            <SettingsRow
              key={subscription.id}
              title={subscription.title}
              icon={<Rss size={18} color="$color11" />}
              trailing={
                <Button size="$2" aria-label={`Unfollow ${subscription.title}`} onPress={() => unfollow.mutate(subscription.id)}>
                  Unfollow
                </Button>
              }
            />
          ))
        )}
      </SettingsSection>

      <YStack gap="$3">
        <XStack items="center" justify="space-between">
          <SizableText size="$5" fontWeight="600" color="$color12">
            Lists
          </SizableText>
          <Button size="$3" icon={<Plus size={16} />} aria-expanded={naming} onPress={() => setNaming(!naming)}>
            New list
          </Button>
        </XStack>
        {naming ? (
          <XStack gap="$2" items="center">
            <YStack flex={1}>
              <TextInput value={name} onChangeText={setName} placeholder="What is this list for?" onSubmitEditing={make} autoFocus />
            </YStack>
            <PrimaryButton size="$3" disabled={name.trim() === '' || create.isPending} onPress={make}>
              Create
            </PrimaryButton>
          </XStack>
        ) : null}

        {playlists.length === 0 && !naming ? (
          <EmptyState icon={<ListMusic size={26} color="$accent11" />} title="No lists yet" body="A list can hold anything you can play, from any source — a film from your server beside a video from the web.">
            {null}
          </EmptyState>
        ) : (
          playlists.map((playlist) => (
            <SettingsSection
              key={playlist.id}
              title={playlist.title}
              footer={playlist.items.length === 1 ? '1 item' : `${playlist.items.length} items`}
            >
              {playlist.items.length === 0 ? (
                <SettingsRow title="Nothing in it yet" subtitle="Open something and choose Add to list." disabled />
              ) : (
                playlist.items.map((item) => (
                  <ItemRow
                    key={`${item.connectionId}:${item.externalId}`}
                    item={item}
                    onRemove={() => removeItem.mutate({ id: playlist.id, key: item })}
                  />
                ))
              )}
              <SettingsRow
                title="Delete this list"
                destructive
                trailing={
                  <ConfirmButton
                    label="Delete"
                    title={`Delete “${playlist.title}”?`}
                    description="The list goes. Nothing in it is deleted."
                    confirmLabel="Delete"
                    onConfirm={() => remove.mutate(playlist.id)}
                  />
                }
              />
            </SettingsSection>
          ))
        )}
      </YStack>

      <Paragraph size="$2" color="$color9">
        Lists travel with your account. They are not a copy of anything on a server — delete a list and nothing on a source changes.
      </Paragraph>
    </Screen>
  );
}

/**
 * One item of a list. A list holds keys, not titles, so the title is asked of
 * whichever source the item came from — and the row still reads, with the id
 * alone, while that source is away.
 */
function ItemRow({ item, onRemove }: { item: GlobalMediaKey; onRemove: () => void }) {
  const detail = useItem(item);
  const title = detail.data?.detail.item.title ?? item.externalId;
  return (
    <SettingsRow
      title={title}
      {...(detail.data ? { subtitle: describeKind(detail.data.detail.item) } : {})}
      href={keyHref(item)}
      trailing={
        <Button size="$2" aria-label={`Remove ${title} from this list`} onPress={onRemove}>
          Remove
        </Button>
      }
    />
  );
}

/** "Film · 2016", or an episode's place in its show. */
function describeKind(item: MediaItem): string {
  if (item.type === 'episode') return [item.showTitle, episodeCode(item)].filter(Boolean).join(' · ');
  return [item.type === 'show' ? 'Series' : 'Film', item.year === undefined ? undefined : String(item.year)].filter(Boolean).join(' · ');
}
