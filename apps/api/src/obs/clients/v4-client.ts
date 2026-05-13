// Phase B fills this in. Phase A only needs the symbol so the factory below
// can resolve. Tests for the v4 path are added in Phase B alongside the real
// implementation.

import type { ConnectOpts, IObsClient } from './types.js';

export class ObsV4Client implements IObsClient {
  async connect(_url: string, _password: string | undefined, _opts: ConnectOpts): Promise<void> {
    throw new Error('ObsV4Client not yet implemented');
  }
  async disconnect(): Promise<void> {
    /* no-op */
  }
  call(_requestType: string, _payload?: Record<string, unknown>): Promise<unknown> {
    return Promise.reject(new Error('ObsV4Client not yet implemented'));
  }
  on(_event: string, _cb: (data: unknown) => void): void {
    /* no-op */
  }
  off(_event: string, _cb: (data: unknown) => void): void {
    /* no-op */
  }
}
