import type { ComponentType } from 'react';

import { isTV } from '@/components/remote';

import * as mobile from './mobile';
import * as tv from './tv';

/** Videos' screens, as its routes draw them: `mobile` on a phone, a tablet or a browser, `tv` on a television. */
export interface VideosUi {
  readonly VideosHome: ComponentType;
}

const ui: VideosUi = isTV ? tv : mobile;

export const { VideosHome } = ui;
