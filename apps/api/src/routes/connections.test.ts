import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from '../test-helpers.js';

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

describe('connections routes — list + create', () => {
  it('rejects unauthenticated requests', async () => {
    const { server, close } = await buildTestServer();
    try {
      const r = await server.inject({ method: 'GET', url: '/api/connections' });
      expect(r.statusCode).toBe(401);
    } finally {
      await close();
    }
  });

  it('creates and lists a connection', async () => {
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const create = await server.inject({
        method: 'POST',
        url: '/api/connections',
        headers: { cookie },
        payload: { name: 'Studio A', host: '10.0.0.5', port: 4455, password: 's3cret' },
      });
      expect(create.statusCode).toBe(201);
      expect(create.json()).toMatchObject({
        name: 'Studio A',
        host: '10.0.0.5',
        port: 4455,
        hasPassword: true,
      });

      const list = await server.inject({
        method: 'GET',
        url: '/api/connections',
        headers: { cookie },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it('rejects invalid payload', async () => {
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const r = await server.inject({
        method: 'POST',
        url: '/api/connections',
        headers: { cookie },
        payload: { name: '', host: 'h', port: 4455 },
      });
      expect(r.statusCode).toBe(400);
    } finally {
      await close();
    }
  });
});
