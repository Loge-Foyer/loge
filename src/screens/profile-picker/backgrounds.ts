import type { ImageContentPosition, ImageSource } from 'expo-image';

/** A photograph behind who's watching on a TV, and whose it is. */
export interface Background {
  /** Bundled with the app: a number on a device, an address and a size in a browser. */
  readonly source: ImageSource | number;
  /** As Unsplash spells it, and as the credit shows it. */
  readonly photographer: string;
  /** Their Unsplash username, without the @. */
  readonly handle: string;
  /** The photo's id on Unsplash: `https://unsplash.com/photos/<photoId>`. */
  readonly photoId: string;
  /** What stays in view where the screen's shape crops the photo. */
  readonly position: ImageContentPosition;
}

/**
 * Photographs from Unsplash, under the Unsplash License rather than the AGPL
 * (`assets/backgrounds/README.md`, `NOTICE`). Each is credited on the screen
 * while it shows.
 */
export const BACKGROUNDS: readonly Background[] = [
  {
    source: require('@/assets/backgrounds/alexander-slattery-LI748t0BK8w.jpg'),
    photographer: 'Alexander Slattery',
    handle: 'slatts',
    photoId: 'LI748t0BK8w',
    position: 'center',
  },
  {
    source: require('@/assets/backgrounds/anders-jilden-cYrMQA7a3Wc.jpg'),
    photographer: 'Anders Jildén',
    handle: 'andersjilden',
    photoId: 'cYrMQA7a3Wc',
    position: 'right',
  },
  {
    source: require('@/assets/backgrounds/dan-freeman-wAn4RfmXtxU.jpg'),
    photographer: 'Dan Freeman',
    handle: 'danfreemanphoto',
    photoId: 'wAn4RfmXtxU',
    position: 'center',
  },
  {
    source: require('@/assets/backgrounds/garrett-parker-DlkF4-dbCOU.jpg'),
    photographer: 'garrett parker',
    handle: 'garrettpsystems',
    photoId: 'DlkF4-dbCOU',
    position: 'center',
  },
  {
    source: require('@/assets/backgrounds/ian-dooley-DuBNA1QMpPA.jpg'),
    photographer: 'ian dooley',
    handle: 'sadswim',
    photoId: 'DuBNA1QMpPA',
    position: 'right',
  },
  {
    source: require('@/assets/backgrounds/qingbao-meng-01_igFr7hd4.jpg'),
    photographer: 'Qingbao Meng',
    handle: 'ideasboom',
    photoId: '01_igFr7hd4',
    position: 'center',
  },
  {
    source: require('@/assets/backgrounds/urban-vintage-78A265wPiO4.jpg'),
    photographer: 'Urban Vintage',
    handle: 'urban_vintage',
    photoId: '78A265wPiO4',
    position: 'right',
  },
];
