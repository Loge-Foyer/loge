/**
 * A TV row's geometry. Every card has a slot of one width, a poster's and its
 * gap, and that slot is all the focus engine ever sees of it: the card the
 * remote is on is drawn wider than its slot, as a scene — 16:9 at the poster's
 * height — and every card after it is drawn further along by the difference,
 * but none of them moves or grows where the remote is concerned. A card whose
 * frame changed as the focus moved sent the next press of right to the end
 * of the row.
 */
export interface RowLayout {
  /** A poster's width and height. */
  readonly poster: number;
  readonly height: number;
  /** The focused card's width: a scene at the poster's height. */
  readonly scene: number;
  readonly gap: number;
  /** One slot: a poster and its gap. */
  readonly slot: number;
  /** How far the cards after the focused one move along. */
  readonly shift: number;
  /** Where the first card starts, and where the focused one is held: the row's own margin. */
  readonly inset: number;
  /** The room after the last slot: enough for it to be scrolled to the margin, so the focused card is always on the left. */
  readonly trailing: number;
}

/** A row `viewport` wide, its cards `poster` wide with `gap` between, its first `inset` from the left. */
export function rowLayout(poster: number, gap: number, inset: number, viewport: number): RowLayout {
  const height = Math.round(poster * 1.5);
  const scene = Math.round((height * 16) / 9);
  const shift = scene - poster;
  const slot = poster + gap;
  return { poster, height, scene, gap, slot, shift, inset, trailing: Math.max(inset + shift, viewport - inset - slot) };
}

/** Where a slot starts in the row's content, from its index: the same whichever card is focused. */
export const slotStart = (layout: RowLayout, index: number): number => layout.inset + index * layout.slot;

/** How far a card moves along: those after the focused one, by the difference; none while the row has no focus. */
export function shiftOf(layout: RowLayout, index: number, focused: number | undefined): number {
  return focused !== undefined && index > focused ? layout.shift : 0;
}

/** A row shows its first twenty, then a card that opens the rest as a grid. */
export const TV_ROW_CARDS = 20;
