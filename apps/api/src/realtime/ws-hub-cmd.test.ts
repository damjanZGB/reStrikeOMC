import { describe, it, expect } from 'vitest';
import { buildTestServer } from '../test-helpers.js';
import { startMockObs } from '../obs/mock-server.js';
import { setupAuthedSocket } from './ws-test-helpers.js';

describe('WS cmd round-trip', () => {
  it('returns cmd.result for a SetCurrentProgramScene fan-out', async () => {
    const mock = await startMockObs({ password: null });
    const { server, close } = await buildTestServer();
    try {
      const sock = await setupAuthedSocket(server);

      const create = await server.inject({
        method: 'POST',
        url: '/api/connections',
        headers: { cookie: sock.cookie },
        payload: { name: 'A', host: '127.0.0.1', port: mock.port },
      });
      const connId = create.json().id as string;

      await server.obsManager.add({
        id: connId,
        host: '127.0.0.1',
        port: mock.port,
        password: null,
      });
      await server.obsManager.waitForStatus(connId, 'connected', 5000);

      // Drain the initial snapshot
      await sock.waitForMessage();

      sock.ws.send(
        JSON.stringify({
          type: 'cmd',
          id: 'r1',
          action: 'SetCurrentProgramScene',
          targets: [connId],
          payload: { sceneName: 'Scene 2' },
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reply = (await sock.waitForMessage(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m) => (m as any)?.type === 'cmd.result'
      )) as any;
      expect(reply.id).toBe('r1');
      expect(reply.ok).toEqual([connId]);
      expect(reply.failed).toEqual([]);

      await sock.close();
    } finally {
      await close();
      await mock.close();
    }
  }, 15000);
});
