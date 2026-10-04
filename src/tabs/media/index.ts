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
  readonly MediaHeaderRight: ComponentType;
  readonly MediaGrid: ComponentType<{ rowId: string }>;
  readonly CustomizeHome: ComponentType<{ rowId?: string }>;
}

const ui: MediaUi = isTV ? tv : mobile;

export const { MediaHome, MediaHeaderRight, MediaGrid, CustomizeHome } = ui;
