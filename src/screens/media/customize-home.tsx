import { ITEM_SORTS, type ContentKind, type ItemSort } from '@sc/api';
import { ArrowDown } from '@tamagui/lucide-icons-2/icons/ArrowDown';
import { ArrowUp } from '@tamagui/lucide-icons-2/icons/ArrowUp';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { RotateCcw } from '@tamagui/lucide-icons-2/icons/RotateCcw';
import { Trash2 } from '@tamagui/lucide-icons-2/icons/Trash2';
import { router } from 'expo-router';
import { ScrollView } from 'react-native';
import { Button, H2, SizableText, XStack, YStack } from 'tamagui';

import { AppSwitch } from '@/components/app-switch';
import { ConfirmButton } from '@/components/confirm-button';
import { CONTENT_KIND_LABELS, rowTitle, SORT_LABELS, sortDirectionLabel } from '@/components/labels';
import { SourceTabs } from '@/components/source-tabs';
import { useHomeLayoutActions, useHomeRows } from '@/hooks/use-home-layout';
import { addRow, moveRow, removeRow, setRow, type CardStyle, type HomeRowView } from '@/services/home-layout';
import { TAB_CONTENT } from '@/services/tab-content';

const SORTS = ITEM_SORTS.map((by) => ({ id: by, label: SORT_LABELS[by] }));
const CARDS = [
  { id: 'poster', label: 'Posters' },
  { id: 'landscape', label: 'Scenes' },
] as const;

/**
 * The home's rows for this profile: their order, whether they show, how each
 * is sorted and drawn. Opened from one row's full list, it edits only that
 * row. Everything here is inline: this may be a native sheet, which a portal
 * would render behind.
 */
export function CustomizeHomeScreen({ rowId }: { rowId?: string }) {
  const { rows } = useHomeRows();
  const { update, reset } = useHomeLayoutActions();
  const all = rows ?? [];
  const shown = rowId ? all.filter((row) => row.id === rowId) : all;
  const kinds = TAB_CONTENT.media.filter((kind) => all.some((row) => row.type === 'kind' && row.kind === kind && row.available));

  return (
    <YStack flex={1} bg="$background">
      <XStack px="$4" pt="$5" pb="$3" items="center" justify="space-between">
        <H2 size="$8" color="$color12">
          {rowId && shown[0] ? rowTitle(shown[0]) : 'Home screen'}
        </H2>
        <Button size="$3" onPress={() => router.back()}>
          Done
        </Button>
      </XStack>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48, gap: 16 }}>
        {shown.map((row) => (
          <RowEditor
            key={row.id}
            row={row}
            first={all[0]?.id === row.id}
            last={all.at(-1)?.id === row.id}
            movable={!rowId}
            onMove={(by) => update.mutate((current) => moveRow(current, row.id, by))}
            onChange={(change) => update.mutate((current) => setRow(current, row.id, change))}
            onRemove={() => update.mutate((current) => removeRow(current, row.id))}
          />
        ))}
        {!rowId && kinds.length > 0 ? (
          <YStack gap="$2" p="$4" rounded="$6" bg="$color2" borderWidth={1} borderColor="$borderColor">
            <SizableText size="$3" fontWeight="600" color="$color12">
              Add a row
            </SizableText>
            <XStack gap="$2" flexWrap="wrap">
              {kinds.map((kind: ContentKind) => (
                <Button
                  key={kind}
                  size="$3"
                  icon={Plus}
                  onPress={() => update.mutate((current) => addRow(current, kind, `${kind}-${Date.now().toString(36)}`))}
                >
                  {CONTENT_KIND_LABELS[kind]}
                </Button>
              ))}
            </XStack>
            <SizableText size="$2" color="$color10">
              A second view of the same library — newest additions first, until you choose another order.
            </SizableText>
          </YStack>
        ) : null}
        {!rowId ? (
          <YStack items="flex-start">
            <ConfirmButton
              label="Reset to default"
              icon={<RotateCcw size={16} />}
              title="Reset the home screen?"
              description="Continue watching, then films and series by release date, newest first. Rows you added are removed."
              confirmLabel="Reset"
              onConfirm={() => reset.mutate()}
            />
          </YStack>
        ) : null}
      </ScrollView>
    </YStack>
  );
}

function RowEditor({
  row,
  first,
  last,
  movable,
  onMove,
  onChange,
  onRemove,
}: {
  row: HomeRowView;
  first: boolean;
  last: boolean;
  movable: boolean;
  onMove: (by: -1 | 1) => void;
  onChange: (change: { sort?: ItemSort; card?: CardStyle; hidden?: boolean }) => void;
  onRemove: () => void;
}) {
  return (
    <YStack gap="$3" p="$4" rounded="$6" bg="$color2" borderWidth={1} borderColor="$borderColor" opacity={row.available ? 1 : 0.6}>
      <XStack items="center" gap="$2">
        <YStack flex={1}>
          <SizableText size="$4" fontWeight="600" color="$color12">
            {rowTitle(row)}
          </SizableText>
          {!row.available ? (
            <SizableText size="$2" color="$color10">
              No source brings this right now
            </SizableText>
          ) : null}
        </YStack>
        {movable ? (
          <>
            <Button size="$3" circular chromeless icon={ArrowUp} disabled={first} aria-label="Move up" onPress={() => onMove(-1)} />
            <Button size="$3" circular chromeless icon={ArrowDown} disabled={last} aria-label="Move down" onPress={() => onMove(1)} />
          </>
        ) : null}
        <AppSwitch label={`Show ${rowTitle(row)}`} checked={!row.hidden} onCheckedChange={(on) => onChange({ hidden: !on })} />
      </XStack>

      {row.type === 'kind' && !row.hidden ? (
        <YStack gap="$3">
          <YStack gap="$1.5">
            <SizableText size="$2" color="$color10">
              Sort by
            </SizableText>
            <SourceTabs
              tabs={SORTS}
              selected={row.sort.by}
              onSelect={(by) => onChange({ sort: { by: by as ItemSort['by'], order: by === 'title' ? 'asc' : 'desc' } })}
            />
            <SourceTabs
              tabs={(['desc', 'asc'] as const).map((order) => ({ id: order, label: sortDirectionLabel({ by: row.sort.by, order }) }))}
              selected={row.sort.order}
              onSelect={(order) => onChange({ sort: { by: row.sort.by, order: order as ItemSort['order'] } })}
            />
          </YStack>
          <YStack gap="$1.5">
            <SizableText size="$2" color="$color10">
              Cards
            </SizableText>
            <SourceTabs tabs={CARDS} selected={row.card} onSelect={(card) => onChange({ card: card as CardStyle })} />
          </YStack>
          {row.extra ? (
            <Button size="$3" chromeless icon={Trash2} color="$red10" self="flex-start" onPress={onRemove}>
              Remove this row
            </Button>
          ) : null}
        </YStack>
      ) : null}
    </YStack>
  );
}
