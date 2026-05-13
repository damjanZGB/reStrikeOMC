import type { IObsClient, ObsProtocol } from './types.js';
import { ObsV5Client } from './v5-client.js';
import { ObsV4Client } from './v4-client.js';

export type { IObsClient, ObsProtocol, ConnectOpts, LifecycleEvent } from './types.js';
export { AuthFailedError } from './types.js';
export { ObsV5Client } from './v5-client.js';
export { ObsV4Client } from './v4-client.js';

/**
 * Factory used by ConnectionManager to instantiate the right client per slot.
 * Switching protocols mid-life requires removing and re-adding the slot.
 */
export function createObsClient(protocol: ObsProtocol): IObsClient {
  switch (protocol) {
    case 'v4':
      return new ObsV4Client();
    case 'v5':
      return new ObsV5Client();
  }
}
