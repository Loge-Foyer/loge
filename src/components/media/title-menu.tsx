import type { DownloadOption, MediaItem, PluginId } from '@loge/api';
import { CirclePlay } from '@tamagui/lucide-icons-2/icons/CirclePlay';
import { Download as DownloadIcon } from '@tamagui/lucide-icons-2/icons/Download';
import { ListPlus } from '@tamagui/lucide-icons-2/icons/ListPlus';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { Trash2 } from '@tamagui/lucide-icons-2/icons/Trash2';
import { useState } from 'react';

import { px } from '@/components/density';
import { fileSize, resolutionName } from '@/components/labels';
import { Menu, MenuHeader, MenuNote, MenuRow } from '@/components/more-menu';
import { useDownloadActions, useDownloadBudget, useDownloadOf, useDownloadOptions } from '@/hooks/use-downloads';
import { useListActions, usePlaylists } from '@/hooks/use-lists';
import type { PlayerSummary } from '@/services/players';
import type { Playlist } from '@/services/ports';

export type TitleMenuPage = 'root' | 'players' | 'lists' | 'download';

const MENU_ICON = { size: px(18), color: '$color11' } as const;

/**
 * What waits behind "⋯": another player, a copy kept on this device, and the
 * profile's own lists. `initialPage` opens it on one of them, for a page that
 * gives each its own button.
 */
export function TitleMenu({
  item,
  open,
  onClose,
  players,
  canList,
  keepable,
  offersChoices,
  onPlayWith,
  initialPage = 'root',
}: {
  item: MediaItem;
  open: boolean;
  onClose: () => void;
  /** The players that can play it here — "Play with…" only when there is more than one. */
  players: readonly PlayerSummary[];
  canList: boolean;
  keepable: boolean;
  offersChoices: boolean;
  onPlayWith: (player: PluginId) => void;
  initialPage?: TitleMenuPage;
}) {
  // A caller opening it on different pages keys it by the page, so each opening starts on its own.
  const [page, setPage] = useState<TitleMenuPage>(initialPage);
  const choosesPlayer = players.length > 1;
  const close = () => {
    onClose();
    setPage(initialPage);
  };
  // Back from a page opened on its own closes it; from one the menu led to, returns.
  const back = () => (initialPage === 'root' ? setPage('root') : close());
  return (
    <Menu open={open} label={`More for ${item.title}`} onClose={close}>
      {page === 'players' ? (
        <>
          <MenuHeader title="Play with" onBack={back} />
          {players.map((player, index) => (
            <MenuRow
              key={player.manifest.id}
              label={player.manifest.displayName}
              preferred={index === 0}
              onPress={() => {
                close();
                onPlayWith(player.manifest.id);
              }}
            />
          ))}
        </>
      ) : page === 'lists' ? (
        <ListsPage item={item} onBack={back} />
      ) : page === 'download' ? (
        <DownloadPage item={item} onBack={back} onDone={close} />
      ) : (
        <>
          {choosesPlayer ? (
            <MenuRow icon={<CirclePlay {...MENU_ICON} />} label="Play with…" more preferred onPress={() => setPage('players')} />
          ) : null}
          {keepable ? (
            <DownloadRow item={item} offersChoices={offersChoices} preferred={!choosesPlayer} onChoose={() => setPage('download')} onDone={close} />
          ) : null}
          {canList ? <ListsRow item={item} preferred={!choosesPlayer && !keepable} onPress={() => setPage('lists')} /> : null}
        </>
      )}
    </Menu>
  );
}

const holds = (list: Playlist, item: MediaItem) =>
  list.items.some((entry) => entry.connectionId === item.key.connectionId && entry.externalId === item.key.externalId);

function ListsRow({ item, preferred, onPress }: { item: MediaItem; preferred: boolean; onPress: () => void }) {
  const { data: lists = [] } = usePlaylists();
  const count = lists.filter((list) => holds(list, item)).length;
  return (
    <MenuRow
      icon={<ListPlus {...MENU_ICON} />}
      label="Add to list"
      {...(count === 0 ? {} : { detail: count === 1 ? 'In 1 list' : `In ${count} lists` })}
      more
      preferred={preferred}
      onPress={onPress}
    />
  );
}

/** The profile's own lists, each ticked where it holds this — a press puts it in, or takes it out. */
function ListsPage({ item, onBack }: { item: MediaItem; onBack: () => void }) {
  const { data: lists = [] } = usePlaylists();
  const { add, removeItem, create } = useListActions();
  return (
    <>
      <MenuHeader title="Add to list" onBack={onBack} />
      {lists.map((list, index) => {
        const inIt = holds(list, item);
        return (
          <MenuRow
            key={list.id}
            label={list.title}
            selected={inIt}
            preferred={index === 0}
            onPress={() => (inIt ? removeItem : add).mutate({ id: list.id, key: item.key })}
          />
        );
      })}
      <MenuRow
        icon={<Plus {...MENU_ICON} />}
        label="New list"
        // Named after what starts it, which is nearly always right and always renameable.
        detail={item.title}
        preferred={lists.length === 0}
        disabled={create.isPending}
        onPress={() => create.mutate(item.title, { onSuccess: (list) => add.mutate({ id: list.id, key: item.key }) })}
      />
    </>
  );
}

/**
 * Keep a copy, and say where it has got to. Where the source offers versions
 * it opens a page of them with their sizes; where it does not, one press takes
 * whatever the source hands over.
 */
function DownloadRow({
  item,
  offersChoices,
  preferred,
  onChoose,
  onDone,
}: {
  item: MediaItem;
  offersChoices: boolean;
  preferred: boolean;
  onChoose: () => void;
  onDone: () => void;
}) {
  const { data: entry } = useDownloadOf(item.key);
  const { data: budget } = useDownloadBudget();
  const { start, remove } = useDownloadActions();
  const icon = <DownloadIcon {...MENU_ICON} />;
  if (entry?.state === 'done') {
    return (
      <MenuRow
        icon={<Trash2 {...MENU_ICON} />}
        label="Delete download"
        detail="Kept on this device"
        preferred={preferred}
        onPress={() => {
          remove.mutate(entry.id);
          onDone();
        }}
      />
    );
  }
  if (entry) {
    const percent =
      entry.bytesTotal === undefined || entry.bytesTotal === 0 ? undefined : Math.round((entry.bytesDone / entry.bytesTotal) * 100);
    return (
      <MenuRow
        icon={icon}
        label={entry.state === 'failed' ? 'Download failed' : 'Downloading'}
        {...(entry.state === 'failed' || percent === undefined ? {} : { detail: `${percent} %` })}
        disabled
      />
    );
  }
  if (budget?.full) return <MenuRow icon={icon} label="Download" detail="No room left" disabled />;
  return (
    <MenuRow
      icon={icon}
      label="Download"
      more={offersChoices}
      preferred={preferred}
      disabled={start.isPending}
      onPress={() => {
        if (offersChoices) {
          onChoose();
          return;
        }
        start.mutate({ item });
        onDone();
      }}
    />
  );
}

/** The versions the source will hand over, each with its size — asked for when this page opens. */
function DownloadPage({ item, onBack, onDone }: { item: MediaItem; onBack: () => void; onDone: () => void }) {
  const { start } = useDownloadActions();
  const { data: options = [], isPending } = useDownloadOptions(item.key, true);
  const take = (optionId?: string) => {
    start.mutate({ item, ...(optionId ? { optionId } : {}) });
    onDone();
  };
  return (
    <>
      <MenuHeader title="Download" onBack={onBack} />
      {isPending ? (
        <MenuNote>Asking the server…</MenuNote>
      ) : options.length === 0 ? (
        <MenuRow label="Download as it is" preferred onPress={() => take()} />
      ) : (
        options.map((option, index) => (
          <MenuRow key={option.id} label={optionLabel(option)} preferred={index === 0} onPress={() => take(option.id)} />
        ))
      )}
    </>
  );
}

/** "1080p · 4.2 GB", with an estimate marked as one. */
function optionLabel(option: DownloadOption): string {
  const size = fileSize(option.estimatedBytes);
  return [
    option.label ?? resolutionName(option.height) ?? 'Original',
    size === undefined ? undefined : option.transcoded ? `about ${size}` : size,
  ]
    .filter(Boolean)
    .join(' · ');
}
