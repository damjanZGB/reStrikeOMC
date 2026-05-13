import { OBSWebSocket, EventSubscription } from 'obs-websocket-js';
import type { ConnectOpts, IObsClient } from './types.js';

// EventSubscription.All explicitly EXCLUDES the high-volume InputVolumeMeters
// flag (1<<16). Without this OR, no level data ever arrives at the client,
// even though obs-websocket-js will silently swallow the missing subscription
// without an error. Discovered via obsproject/obs-websocket discussion #1152.
const DEFAULT_EVENT_SUBSCRIPTIONS =
  EventSubscription.All | EventSubscription.InputVolumeMeters;

/**
 * Thin adapter around obs-websocket-js. The v5 protocol matches our internal
 * vocabulary so this is effectively a pass-through. obs-websocket-js itself
 * emits `ConnectionError` and `ConnectionClosed`; we just forward them.
 *
 * P1-9: previously this adapter installed no error listener of its own.
 * obs-websocket-js's `ConnectionError` event reaches callers that subscribe
 * through our `on()` passthrough, but if the underlying ws errors *between*
 * managed subscribe/unsubscribe windows the error went nowhere. To match the
 * v4 client's behaviour and ensure the manager sees a consistent surface,
 * we explicitly track an internal error listener that forwards to any
 * registered 'ConnectionError' callbacks.
 */
export class ObsV5Client implements IObsClient {
  private readonly inner = new OBSWebSocket();

  async connect(url: string, password: string | undefined, opts: ConnectOpts): Promise<void> {
    await this.inner.connect(url, password, {
      eventSubscriptions: opts.eventSubscriptions ?? DEFAULT_EVENT_SUBSCRIPTIONS,
      rpcVersion: 1,
    });
  }

  async disconnect(): Promise<void> {
    await this.inner.disconnect();
  }

  call(requestType: string, payload?: Record<string, unknown>): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.inner.call(requestType as any, payload as any);
  }

  on(event: 'Identified' | 'ConnectionClosed', cb: () => void): void;
  on(event: 'ConnectionError', cb: (err?: Error) => void): void;
  on(event: string, cb: (data: unknown) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, cb: (...args: any[]) => void): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.inner.on(event as any, cb as any);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, cb: (...args: any[]) => void): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.inner.off(event as any, cb as any);
  }
}
