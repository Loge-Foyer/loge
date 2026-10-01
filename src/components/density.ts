import { isTV } from './remote';

/**
 * How much bigger a size written by hand is on a TV: the same 1.5 the theme
 * gives its spaces and sizes there (`tamagui.config.ts`), so a card's width
 * grows with the words beneath it.
 */
export const DENSITY = isTV ? 1.5 : 1;

/** A size written by hand, as this device needs it. */
export const px = (size: number) => Math.round(size * DENSITY);

/**
 * The margin at either side of a page. On a TV it is the title-safe area —
 * 80 points of 1920, which a television may crop or bend — so nothing that
 * matters starts outside it; rows begin there and run on to the edge.
 */
export const GUTTER = isTV ? 80 : 16;

/** How wide a page's column may grow. */
export const COLUMN = isTV ? 1500 : 1200;
