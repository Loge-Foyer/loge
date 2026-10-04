import { ITEM_SORTS, type ContentKind, type ItemSort } from '@loge/api';
import { ArrowDown } from '@tamagui/lucide-icons-2/icons/ArrowDown';
import { ArrowUp } from '@tamagui/lucide-icons-2/icons/ArrowUp';
import { ChevronDown } from '@tamagui/lucide-icons-2/icons/ChevronDown';
import { Plus } from '@tamagui/lucide-icons-2/icons/Plus';
import { RotateCcw } from '@tamagui/lucide-icons-2/icons/RotateCcw';
import { Trash2 } from '@tamagui/lucide-icons-2/icons/Trash2';
import { useState, type ReactNode } from 'react';
import { SizableText, XStack, YStack } from 'tamagui';

import { AppSwitch } from '@/components/app-switch';
import { Button } from '@/components/button';
import { ConfirmButton } from '@/components/confirm-button';
import { CONTENT_KIND_LABELS, rowTitle, SORT_LABELS, sortDirectionLabel } from '@/components/labels';
import { OverlayPicker } from '@/components/overlay-picker';
import { CHOSEN } from '@/components/settings-list';
import { SheetScreen } from '@/components/sheet';
import { SourceTabs } from '@/components/source-tabs';
import { useHomeLayoutActions, useHomeRows } from '@/hooks/use-home-layout';
import { useGenres } from '@/hooks/use-media';
import { addRow, moveRow, removeRow, setGenre, setRow, type CardStyle, type HomeFeeds, type HomeRowView, type TitlesRow } from '@/services/home-layout';
import { TAB_CONTENT } from '@/services/tab-content';

const SORTS = ITEM_SORTS.map((by) => ({ id: by, label: SORT_LABELS[by] }));
const CARDS = [
  { id: 'poster', label: 'Posters' },
  { id: 'landscape', label: 'Scenes' },
] as const;
// "Any category" in the picker: no genre, which no source names.
const EVERY_GENRE = '';

/**
 * The home's rows for this profile: their order, whether they show, what each
 * holds — one kind or several, of every category or of one — and how it is
 * sorted and drawn; and a row of its own to add. Opened from one row's full
 * list, it edits only that row. Everything here is inline, or React Native's
 * own modal: this may be a native sheet, which a portal would render behind.
 */
export function CustomizeHomeScreen({ rowId }: { rowId?: string }) {
  const { rows, feeds } = useHomeRows();
  const { update, reset } = useHomeLayoutActions();
  const all = rows ?? [];
  const shown = rowId ? all.filter((row) => row.id === rowId) : all;
  const kinds = TAB_CONTENT.media.filter((kind) => feeds?.kinds.has(kind) ?? false);

  return (
    <SheetScreen title={rowId && shown[0] ? rowTitle(shown[0]) : 'Home screen'}>
      {shown.map((row) => (
        <RowEditor
          key={row.id}
          row={row}
          kinds={kinds}
          feeds={feeds}
          first={all[0]?.id === row.id}
          last={all.at(-1)?.id === row.id}
          movable={!rowId}
          onMove={(by) => update.mutate((current) => moveRow(current, row.id, by))}
          onChange={(change) => update.mutate((current) => setRow(current, row.id, change))}
          onGenre={(genre) => update.mutate((current) => setGenre(current, row.id, genre))}
          onRemove={() => update.mutate((current) => removeRow(current, row.id))}
        />
      ))}
      {!rowId && kinds.length > 0 ? (
        <AddRow kinds={kinds} feeds={feeds} onAdd={(what) => update.mutate((current) => addRow(current, what, `row-${Date.now().toString(36)}`))} />
      ) : null}
      {!rowId ? (
        <YStack items="flex-start">
          <ConfirmButton
            label="Reset to default"
            icon={<RotateCcw size={16} />}
            title="Reset the home screen?"
            description="Continue watching and what is downloaded, then films and series by release date, newest first. Rows you added are removed."
            confirmLabel="Reset"
            onConfirm={() => reset.mutate()}
          />
        </YStack>
      ) : null}
    </SheetScreen>
  );
}

function RowEditor({
  row,
  kinds,
  feeds,
  first,
  last,
  movable,
  onMove,
  onChange,
  onGenre,
  onRemove,
}: {
  row: HomeRowView;
  kinds: readonly ContentKind[];
  feeds: HomeFeeds | undefined;
  first: boolean;
  last: boolean;
  movable: boolean;
  onMove: (by: -1 | 1) => void;
  onChange: (change: Partial<Pick<TitlesRow, 'kinds' | 'sort' | 'card' | 'hidden'>>) => void;
  onGenre: (genre: string | undefined) => void;
  onRemove: () => void;
}) {
  const why =
    row.type === 'downloads'
      ? 'This device keeps no downloads'
      : row.type === 'titles' && row.genre !== undefined
        ? 'No source here can narrow to a category'
        : 'No source brings this right now';
  return (
    <YStack gap="$3" p="$5" rounded="$6" bg="$color2" borderWidth={1} borderColor="$borderColor" opacity={row.available ? 1 : 0.6}>
      <XStack items="center" gap="$2">
        <YStack flex={1}>
          <SizableText size="$4" fontWeight="600" color="$color12">
            {rowTitle(row)}
          </SizableText>
          {!row.available ? (
            <SizableText size="$2" color="$color10">
              {why}
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

      {row.type === 'titles' && !row.hidden ? (
        <YStack gap="$3">
          <Field label="Shows">
            <KindChips kinds={kinds} chosen={row.kinds} onChange={(next) => onChange({ kinds: next })} />
          </Field>
          <Field label="Category">
            <CategoryChoice kinds={row.kinds} feeds={feeds} genre={row.genre} onChange={onGenre} />
          </Field>
          <Field label="Sort by">
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
          </Field>
          <Field label="Cards">
            <SourceTabs tabs={CARDS} selected={row.card} onSelect={(card) => onChange({ card: card as CardStyle })} />
          </Field>
          {row.extra ? (
            <Button size="$3" chromeless icon={Trash2} color="$red11" self="flex-start" onPress={onRemove}>
              Remove this row
            </Button>
          ) : null}
        </YStack>
      ) : null}
    </YStack>
  );
}

/** A row of the profile's own: one kind or several — all of them to begin with — and a category if it likes. */
function AddRow({
  kinds,
  feeds,
  onAdd,
}: {
  kinds: readonly ContentKind[];
  feeds: HomeFeeds | undefined;
  onAdd: (what: { readonly kinds: readonly ContentKind[]; readonly genre?: string }) => void;
}) {
  const [chosen, setChosen] = useState<readonly ContentKind[]>(kinds);
  const [genre, setGenreChoice] = useState<string>();
  // What the sources still bring of what was chosen; everything, where nothing chosen is left.
  const kept = chosen.filter((kind) => kinds.includes(kind));
  const holds = kept.length > 0 ? kept : kinds;
  return (
    <YStack gap="$3" p="$5" rounded="$6" bg="$color2" borderWidth={1} borderColor="$borderColor">
      <SizableText size="$3" fontWeight="600" color="$color12">
        Add a row
      </SizableText>
      <Field label="Shows">
        <KindChips kinds={kinds} chosen={holds} onChange={setChosen} />
      </Field>
      <Field label="Category">
        <CategoryChoice kinds={holds} feeds={feeds} genre={genre} onChange={setGenreChoice} />
      </Field>
      <Button size="$3" icon={Plus} self="flex-start" onPress={() => onAdd({ kinds: holds, ...(genre ? { genre } : {}) })}>
        Add this row
      </Button>
      <SizableText size="$2" color="$color10">
        Films and series side by side, a category of them — “Comedy” — or both at once: “Comedy movies”.
      </SizableText>
    </YStack>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <YStack gap="$1.5">
      <SizableText size="$2" color="$color10">
        {label}
      </SizableText>
      {children}
    </YStack>
  );
}

/** Each kind the sources bring, several at once; the last one left stays. */
function KindChips({ kinds, chosen, onChange }: { kinds: readonly ContentKind[]; chosen: readonly ContentKind[]; onChange: (kinds: readonly ContentKind[]) => void }) {
  return (
    <XStack gap="$2" flexWrap="wrap">
      {kinds.map((kind) => {
        const on = chosen.includes(kind);
        return (
          <Button
            key={kind}
            size="$3"
            rounded="$10"
            borderWidth={0}
            bg={on ? CHOSEN.bg : '$color3'}
            color={on ? CHOSEN.color : '$color11'}
            aria-label={`${CONTENT_KIND_LABELS[kind]}${on ? ', in this row' : ''}`}
            disabled={on && chosen.length === 1}
            onPress={() => onChange(on ? chosen.filter((each) => each !== kind) : [...chosen, kind])}
          >
            {CONTENT_KIND_LABELS[kind]}
          </Button>
        );
      })}
    </XStack>
  );
}

/** Any category, or one the sources of these kinds file titles under — chosen over the whole screen. */
function CategoryChoice({
  kinds,
  feeds,
  genre,
  onChange,
}: {
  kinds: readonly ContentKind[];
  feeds: HomeFeeds | undefined;
  genre: string | undefined;
  onChange: (genre: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const narrowing = kinds.filter((kind) => feeds?.genreKinds.has(kind) ?? false);
  const genres = useGenres(narrowing, open);
  if (narrowing.length === 0) {
    return (
      <SizableText size="$2" color="$color10">
        {genre ? `${genre} — no source here can narrow to a category.` : 'No source here can narrow to a category.'}
      </SizableText>
    );
  }
  return (
    <>
      <Button
        size="$3"
        self="flex-start"
        rounded="$10"
        borderWidth={0}
        bg={genre ? CHOSEN.bg : '$color3'}
        color={genre ? CHOSEN.color : '$color11'}
        iconAfter={<ChevronDown size={14} />}
        onPress={() => setOpen(true)}
      >
        {genre ?? 'Any category'}
      </Button>
      <OverlayPicker
        open={open}
        label="Category"
        options={[{ id: EVERY_GENRE, label: 'Any category' }, ...(genres.data?.genres ?? []).map((name) => ({ id: name, label: name }))]}
        selected={genre ?? EVERY_GENRE}
        onSelect={(choice) => onChange(choice === EVERY_GENRE ? undefined : choice)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
