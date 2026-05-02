import { describe, it, expect } from 'vitest';
import { buildTestServer } from '../test-helpers.js';
import { ServerMessageSchema } from '@restrike/shared';
import { setupAuthedSocket } from './ws-test-helpers.js';

describe('WS Hub broadcast', () => {
  it('sends initial state.snapshot on connect', async () => {
    const { server, close } = await buildTestServer();
    try {
      const sock = await setupAuthedSocket(server);
      const msg = await sock.waitForMessage();
      const parsed = ServerMessageSchema.parse(msg);
      expect(parsed.type).toBe('state.snapshot');
      await sock.close();
    } finally {
      await close();
    }
  }, 10000);
});
