// expo-video as the built-in player's native engine sees it, in memory. The
// test drives the engine's events; the fake records what the engine asked.
type Listener = (payload: never) => void;

export interface FakeTrack {
  readonly id?: string;
  readonly language: string;
  readonly label: string;
  readonly name?: string;
  readonly isDefault?: boolean;
}

export class FakeVideoPlayer {
  currentTime = 0;
  duration = 0;
  playing = false;
  status: 'idle' | 'loading' | 'readyToPlay' | 'error' = 'idle';
  isLive = false;
  timeUpdateEventInterval = 0;
  bufferOptions: unknown = undefined;
  audioTrack: FakeTrack | null = null;
  subtitleTrack: FakeTrack | null = null;
  released = false;
  readonly sources: unknown[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  addListener(name: string, listener: Listener) {
    const set = this.listeners.get(name) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(name, set);
    return { remove: () => set.delete(listener) };
  }

  /** What the native side would send. */
  emit(name: string, payload?: unknown) {
    if (name === 'statusChange') this.status = (payload as { status: FakeVideoPlayer['status'] }).status;
    if (name === 'playingChange') this.playing = (payload as { isPlaying: boolean }).isPlaying;
    for (const listener of [...(this.listeners.get(name) ?? [])]) (listener as (payload: unknown) => void)(payload);
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }

  async replaceAsync(source: unknown) {
    this.sources.push(source);
  }

  play() {
    this.playing = true;
  }

  pause() {
    this.playing = false;
  }

  release() {
    this.released = true;
  }
}

export const created: FakeVideoPlayer[] = [];

export function createVideoPlayer(source: unknown): FakeVideoPlayer {
  const player = new FakeVideoPlayer();
  if (source !== null) player.sources.push(source);
  created.push(player);
  return player;
}

export function VideoView(): null {
  return null;
}
