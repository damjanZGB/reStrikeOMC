/**
 * Protocol-agnostic OBS WebSocket client interface.
 *
 * Two concrete implementations live in this directory:
 *   - v5-client.ts: a thin wrapper around obs-websocket-js (v5 protocol).
 *   - v4-client.ts: a hand-rolled client for the legacy v4 wire protocol.
 *
 * Everything *outside* of clients/ speaks the v5 vocabulary (request names,
 * event names, payload shapes). The v4 client translates at its boundary.
 */

export type ObsProtocol = 'v4' | 'v5';

export interface ConnectOpts {
  /**
   * v5-only: subscription bitfield. v4 ignores it (no subscription concept).
   * When omitted, the v5 adapter applies its own default (All | InputVolumeMeters).
   */
  eventSubscriptions?: number;
}

/**
 * Lifecycle events emitted by every client implementation. These mirror the
 * names obs-websocket-js exposes so the manager handles both paths uniformly.
 */
export type LifecycleEvent = 'Identified' | 'ConnectionClosed' | 'ConnectionError';

export interface IObsClient {
  connect(url: string, password: string | undefined, opts: ConnectOpts): Promise<void>;
  disconnect(): Promise<void>;
  /** Internal (v5-vocab) command name. v4 client translates inward. */
  call(requestType: string, payload?: Record<string, unknown>): Promise<unknown>;
  on(event: LifecycleEvent, cb: () => void): void;
  on(event: string, cb: (data: unknown) => void): void;
  off?(event: string, cb: (data: unknown) => void): void;
}

/**
 * Throw from a client's connect() when the server rejects credentials.
 * Mirrors the obs-websocket-js error shape (`code === 4009`) so existing
 * callers in connection-manager.ts keep working unchanged.
 */
export class AuthFailedError extends Error {
  readonly code = 4009;
  constructor(message = 'authentication failed') {
    super(message);
    this.name = 'AuthFailedError';
  }
}
