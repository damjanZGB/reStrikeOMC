import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from '../test-helpers.js';
import { startMockObs, type MockHandle } from '../obs/mock-server.js';
import { startMockObsV4, type MockV4Handle } from '../obs/mock-server-v4.js';

let mockV5: MockHandle;
let mockV4: MockV4Handle;

beforeAll(async () => {
  mockV5 = await startMockObs({ password: null });
  mockV4 = await startMockObsV4({ password: null });
});

afterAll(async () => {
  await mockV5.close();
  await mockV4.close();
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

  it('tags discovered v5 hosts with protocol:v5', async () => {
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const r = await server.inject({
        method: 'GET',
        url: `/api/discover?port=${mockV5.port}&cidr=127.0.0.1`,
        headers: { cookie },
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as {
        hosts: Array<{ host: string; port: number; protocol: 'v4' | 'v5' }>;
      };
      const match = body.hosts.find((h) => h.host === '127.0.0.1' && h.port === mockV5.port);
      expect(match).toBeDefined();
      expect(match?.protocol).toBe('v5');
    } finally {
      await close();
    }
  }, 30_000);

  it('tags discovered v4 hosts with protocol:v4', async () => {
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const r = await server.inject({
        method: 'GET',
        url: `/api/discover?port=${mockV4.port}&cidr=127.0.0.1`,
        headers: { cookie },
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as {
        hosts: Array<{ host: string; port: number; protocol: 'v4' | 'v5' }>;
      };
      const match = body.hosts.find((h) => h.host === '127.0.0.1' && h.port === mockV4.port);
      expect(match).toBeDefined();
      expect(match?.protocol).toBe('v4');
    } finally {
      await close();
    }
  }, 30_000);
});
