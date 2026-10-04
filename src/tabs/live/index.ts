import type { GlobalMediaKey } from '@loge/api';
import type { ComponentType } from 'react';

import { isTV } from '@/components/remote';

import * as mobile from './mobile';
import * as tv from './tv';

/** Live's screens, as its routes draw them: `mobile` on a phone, a tablet or a browser, `tv` on a television. */
export interface LiveUi {
  readonly LiveHome: ComponentType;
  readonly ChannelGuide: ComponentType<{ channel: GlobalMediaKey; name: string; group?: string }>;
}

const ui: LiveUi = isTV ? tv : mobile;

export const { LiveHome, ChannelGuide } = ui;
