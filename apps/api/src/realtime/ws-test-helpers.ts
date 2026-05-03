import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';

export interface AuthedWs {
  ws: WebSocket;
  port: string;
  cookie: string;
  queue: unknown[];
  waitForMessage: (predicate?: (m: unknown) => boolean, timeoutMs?: number) => Promise<unknown>;
  close: () => Promise<void>;
}

export async function setupAuthedSocket(server: FastifyInstance): Promise<AuthedWs> {
  const url = await server.listen({ port: 0, host: '127.0.0.1' });
  const port = url.split(':').pop()!;
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
  const cookie = String(login.headers['set-cookie']).split(';')[0] ?? '';

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
  const queue: unknown[] = [];
  ws.on('message', (raw) => {
    try {
      queue.push(JSON.parse((raw as Buffer).toString()));
    } catch (err) {
      queue.push({ __parseError: String(err) });
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });

  async function waitForMessage(
    predicate: (m: unknown) => boolean = () => true,
    timeoutMs = 5000
  ): Promise<unknown> {
    const start = Date.now();
    let cursor = 0;
    while (Date.now() - start < timeoutMs) {
      while (cursor < queue.length) {
        const m = queue[cursor++];
        if (predicate(m)) return m;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`waitForMessage timeout. queue=${JSON.stringify(queue)}`);
  }

  return {
    ws,
    port,
    cookie,
    queue,
    waitForMessage,
    close: async () => {
      ws.close();
    },
  };
}
