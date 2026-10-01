/** The part of an `AbortSignal` a plugin needs. A DOM `AbortSignal` fits it. */
export interface CancelSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

export interface HttpRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Gives up after this long, reading the body included. */
  readonly timeoutMs?: number;
  readonly signal?: CancelSignal;
}

export interface HttpResponse {
  readonly status: number;
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
  readonly text: string;
}

/**
 * Why a request produced no response at all. `offline`: the device has no
 * network. `unreachable`: the network is there, the server is not.
 */
export type TransportFailure = 'offline' | 'unreachable' | 'timeout' | 'aborted';

/** The request never got a response. Every HTTP status, a 500 too, is a response. */
export class TransportError extends Error {
  readonly kind: TransportFailure;

  constructor(kind: TransportFailure, message: string = kind) {
    super(message);
    this.name = 'TransportError';
    this.kind = kind;
  }
}

export function isTransportError(error: unknown): error is TransportError {
  return error instanceof TransportError;
}

/**
 * Supplied by the app. It resolves for every HTTP status, rejects only with a
 * `TransportError`, and never logs a header or a body.
 */
export interface HttpClient {
  request(request: HttpRequest): Promise<HttpResponse>;
}
