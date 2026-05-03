import { describe, it, expect } from 'vitest';
import { WebSocket } from 'ws';
import { buildTestServer } from '../test-helpers.js';

describe('WS Hub auth', () => {
  it('rejects upgrade without cookie', async () => {
    const { server, close } = await buildTestServer();
    try {
      const url = await server.listen({ port: 0, host: '127.0.0.1' });
      const port = url.split(':').pop();
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const closed = new Promise<number>((resolve) =>
        ws.on('close', (code) => resolve(code))
      );
      ws.on('error', () => {
        // expected
      });
      const code = await closed;
      expect(code).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it('accepts upgrade with valid session cookie', async () => {
    const { server, close } = await buildTestServer();
    try {
      const url = await server.listen({ port: 0, host: '127.0.0.1' });
      const port = url.split(':').pop();
      await server.inject({
        method: 'POST',
        url: '/api/setup',
        payload: { username: 'a', password: 'longenoughpw' },
      });
      const login = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'a', password: 'longenoughpw' },
      });
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Cookie: cookie ?? '' },
      });
      const opened = new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
      });
      await opened;
      ws.close();
    } finally {
      await close();
    }
  });
});
