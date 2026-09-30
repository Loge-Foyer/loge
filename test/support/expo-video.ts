// expo-video needs a native module Node does not have. The tests read the
// built-in player's manifest and never play: an engine made here fails loudly.
export function createVideoPlayer(): never {
  throw new Error('expo-video has no native module in the tests.');
}

export function VideoView(): null {
  return null;
}
