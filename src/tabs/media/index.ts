import type { GlobalMediaKey } from '@loge/api';
import type { ComponentType } from 'react';

import { isTV } from '@/components/remote';

import * as mobile from './mobile';
import * as tv from './tv';

/**
 * Media's screens, as its routes draw them. A phone, a tablet and a browser
 * take `mobile`, a television `tv`: one bundle serves all of them, told apart
 * at runtime, and each form factor provides every screen.
 */
export interface MediaUi {
  readonly MediaHome: ComponentType;
  /** What sits beside the profile at the right of the home's native header. */
  readonly MediaHeaderRight: ComponentType;
  /** A row's grid, narrowed as the home was (`kind`, `genre`, as its address carries them). */
  readonly MediaGrid: ComponentType<{ rowId: string; kind?: string; genre?: string }>;
  readonly MediaSearch: ComponentType;
  readonly CustomizeHome: ComponentType<{ rowId?: string }>;
  /** A title's own page: a sheet on a phone, the whole screen on a TV. */
  readonly TitleScreen: ComponentType<{ itemKey: GlobalMediaKey; season?: string }>;
}

const ui: MediaUi = isTV ? tv : mobile;

export const { MediaHome, MediaHeaderRight, MediaGrid, MediaSearch, CustomizeHome, TitleScreen } = ui;
