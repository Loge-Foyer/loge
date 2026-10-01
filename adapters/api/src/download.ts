import type { GlobalMediaKey, HdrFormat, HeadersRef, SubtitleStreamInfo } from './media';

/**
 * Keeping a copy on the device — as against playing one, which is
 * `playback.ts`.
 *
 * Two things are deliberately separate. **What versions there are** is a
 * question a source can usually answer cheaply, and the app asks it to draw a
 * list of choices with sizes. **How to fetch one** is a second question,
 * asked once the user has chosen, because the answer may be a URL that
 * expires, carries a token, or starts work on the server.
 *
 * A `DownloadDescriptor` is as secret as a `PlaybackDescriptor`: its address
 * can hold an `api_key`, an HMAC signature or a session token. It lives in
 * memory, is never logged, and is never written to a row.
 */

/** What the user asked for, where the source can make something smaller. */
export interface DownloadQuality {
  /** The tallest picture worth keeping: 1080 on a phone, say. */
  readonly maxHeight?: number;
  /** Bits per second. What turns an 80 GB film into a 3 GB one. */
  readonly maxBitrate?: number;
  /** Whether to keep HDR. Tone-mapping to SDR is a transcode either way. */
  readonly hdr: boolean;
  /** 8 keeps a file smaller and plays on more; 10 is what HDR needs. */
  readonly maxBitDepth?: 8 | 10;
}

/**
 * One version a source will hand over. The adapter states numbers; the app
 * words them — "1080p · 4.2 GB" is the app's sentence, not the source's.
 */
export interface DownloadOption {
  /** The source's own id for this choice, opaque above the adapter. */
  readonly id: string;
  /** What the source calls it, where that says more than the numbers do. */
  readonly label?: string;
  readonly height?: number;
  readonly bitrate?: number;
  /**
   * What it will weigh. An estimate where the source is transcoding and does
   * not know yet; exact where the file already exists.
   */
  readonly estimatedBytes?: number;
  readonly container?: string;
  readonly videoCodec?: string;
  readonly audioCodecs?: readonly string[];
  readonly hdr?: HdrFormat;
  /**
   * Whether the server will re-encode this, as against handing over something
   * it already has. A transcode costs the server time and may arrive no faster
   * than it plays; a file that exists comes down as fast as the link allows.
   */
  readonly transcoded: boolean;
}

export interface DownloadRequest {
  readonly key: GlobalMediaKey;
  /** The option the user chose, from `listDownloadOptions`. */
  readonly optionId?: string;
  /** What to aim for where no option was named and the source can transcode. */
  readonly quality?: DownloadQuality;
  readonly audioTrackId?: string;
  readonly subtitleTrackId?: string;
}

/** A subtitle worth keeping beside the file, fetched separately. */
export interface DownloadSubtitle extends SubtitleStreamInfo {
  readonly id: string;
  readonly uri: string;
  readonly headersRef?: HeadersRef;
}

/** One file to fetch and keep. Memory only — never a row, never a log. */
export interface DownloadDescriptor {
  readonly key: GlobalMediaKey;
  readonly uri: string;
  readonly headersRef?: HeadersRef;
  /**
   * The file's extension once it is on the device. A download is always one
   * file: a source that can only offer a manifest cannot be downloaded, and
   * says so by not declaring `downloads`.
   */
  readonly container: string;
  readonly videoCodec?: string;
  readonly audioCodecs?: readonly string[];
  readonly height?: number;
  readonly hdr?: HdrFormat;
  readonly transcoded: boolean;
  /** Where the source knows it. The app checks its budget against this first. */
  readonly expectedBytes?: number;
  readonly durationMs?: number;
  /** Fetched alongside and kept with the file. */
  readonly subtitles: readonly DownloadSubtitle[];
}
