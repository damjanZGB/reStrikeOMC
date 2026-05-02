import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from '../test-helpers.js';

let probe: Server;
let probePort: number;

beforeAll(async () => {
  probe = createServer((sock) => sock.end());
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  probePort = (probe.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => probe.close(() => resolve()));
});

async function login(server: FastifyInstance): Promise<string> {
  await server.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { username: 'a', password: 'longenoughpw' },
  });
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'a', password: 'longenoughpw' },
  });
  return String(r.headers['set-cookie']).split(';')[0] ?? '';
}

describe('GET /api/discover', () => {
  it('rejects unauthenticated requests', async () => {
    const { server, close } = await buildTestServer();
    try {
      const r = await server.inject({ method: 'GET', url: '/api/discover' });
      expect(r.statusCode).toBe(401);
    } finally {
      await close();
    }
  });

  it('returns hosts found on the loopback /24', async () => {
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const r = await server.inject({
        method: 'GET',
        url: `/api/discover?port=${probePort}&cidr=127.0.0.1`,
        headers: { cookie },
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { hosts: Array<{ host: string; port: number }> };
      expect(
        body.hosts.some((h) => h.host === '127.0.0.1' && h.port === probePort)
      ).toBe(true);
    } finally {
      await close();
    }
  }, 30_000);
});
