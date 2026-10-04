import { isTV } from '@/components/remote';

import { MobileProfilePicker } from './mobile';
import { TvProfilePicker } from './tv';
import type { PickerMode } from './use-profile-picker';

/**
 * "Who's watching?" — at launch when there is no default profile, and as the
 * profile switcher while the app runs. Switching never restarts anything. A
 * phone, a tablet and a browser get a grid of tiles; a TV, a column of them
 * over a photograph, for a remote.
 */
export function ProfilePicker({ mode }: { mode: PickerMode }) {
  return isTV ? <TvProfilePicker mode={mode} /> : <MobileProfilePicker mode={mode} />;
}
