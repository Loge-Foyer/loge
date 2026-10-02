import type { PlaybackReport } from '@loge/api';

/**
 * What a new report of each kind makes redundant among the same item's waiting
 * ones: the newest progress is the only one worth sending, a stop says where
 * it ended, and the newest watched state is the user's last word.
 */
export const SUPERSEDES: Readonly<Record<PlaybackReport['kind'], readonly PlaybackReport['kind'][]>> = {
  started: [],
  progress: ['progress'],
  stopped: ['progress'],
  played: ['played'],
};
