// expo's modules API as the native players' engines see it, in memory: each
// Expo module's player as a shared object. The test sends the native side's
// events; the fake records what the engine asked.
type Listener = (payload: never) => void;

export class SharedObject {
  private readonly listeners = new Map<string, Set<Listener>>();
  released = false;

  addListener(name: string, listener: Listener) {
    const set = this.listeners.get(name) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(name, set);
    return { remove: () => set.delete(listener) };
  }

  /** What the native side would send. */
  emit(name: string, payload?: unknown) {
    for (const listener of [...(this.listeners.get(name) ?? [])]) (listener as (payload: unknown) => void)(payload);
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }

  release() {
    this.released = true;
  }
}

export interface FakeLoad {
  readonly uri: string;
  readonly userAgent: string | null;
  readonly referrer: string | null;
  readonly startMs: number | null;
}

export class FakeVlcPlayer extends SharedObject {
  readonly loads: FakeLoad[] = [];
  readonly calls: string[] = [];
  audioTrack: number | undefined;
  subtitleTrack: number | undefined;

  constructor() {
    super();
    created.push(this);
  }

  async load(uri: string, userAgent: string | null, referrer: string | null, startMs: number | null) {
    this.loads.push({ uri, userAgent, referrer, startMs });
  }

  play() {
    this.calls.push('play');
  }

  pause() {
    this.calls.push('pause');
  }

  replay(startMs: number) {
    this.calls.push(`replay ${startMs}`);
  }

  seek(positionMs: number) {
    this.calls.push(`seek ${positionMs}`);
  }

  rate = 1;
  volume = 100;

  setRate(rate: number) {
    this.rate = rate;
  }

  setVolume(volume: number) {
    this.volume = volume;
  }

  setAudioTrack(id: number) {
    this.audioTrack = id;
  }

  setSubtitleTrack(id: number) {
    this.subtitleTrack = id;
  }
}

export const created: FakeVlcPlayer[] = [];

export interface FakeMpvLoad {
  readonly uri: string;
  readonly headers: Readonly<Record<string, string>> | null;
  readonly startMs: number | null;
}

/** mpv's module: the same shape, except that mpv takes whatever headers a stream needs. */
export class FakeMpvPlayer extends SharedObject {
  readonly loads: FakeMpvLoad[] = [];
  readonly calls: string[] = [];
  audioTrack: number | undefined;
  subtitleTrack: number | undefined;

  constructor() {
    super();
    createdMpv.push(this);
  }

  async load(uri: string, headers: Readonly<Record<string, string>> | null, startMs: number | null) {
    this.loads.push({ uri, headers, startMs });
  }

  play() {
    this.calls.push('play');
  }

  pause() {
    this.calls.push('pause');
  }

  replay(startMs: number) {
    this.calls.push(`replay ${startMs}`);
  }

  seek(positionMs: number) {
    this.calls.push(`seek ${positionMs}`);
  }

  rate = 1;
  volume = 100;

  setRate(rate: number) {
    this.rate = rate;
  }

  setVolume(volume: number) {
    this.volume = volume;
  }

  setAudioTrack(id: number) {
    this.audioTrack = id;
  }

  setSubtitleTrack(id: number) {
    this.subtitleTrack = id;
  }
}

export const createdMpv: FakeMpvPlayer[] = [];

export function requireNativeModule(name: string): unknown {
  if (name === 'ScVlc') return { Player: FakeVlcPlayer };
  if (name === 'ScMpv') return { Player: FakeMpvPlayer };
  throw new Error(`Cannot find native module '${name}'`);
}

export function requireNativeView(): () => null {
  return () => null;
}
