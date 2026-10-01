import type { PictureInPicture } from '@/services/ports';

// A browser shrinks the video element, not the page: the engine does it.
export const pictureInPicture: PictureInPicture = {
  available: () => false,
  setAutoEnter: () => undefined,
  subscribe: () => () => undefined,
};
