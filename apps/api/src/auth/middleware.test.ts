import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from '../test-helpers.js';

async function loginAndGetCookie(server: FastifyInstance): Promise<string> {
  await server.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { username: 'alice', password: 'longenoughpw' },
  });
  const res = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'alice', password: 'longenoughpw' },
  });
  return String(res.headers['set-cookie']).split(';')[0];
}

describe('requireSession', () => {
  it('rejects unauthenticated requests', async () => {
    const { server, close } = await buildTestServer();
    try {
      const res = await server.inject({ method: 'GET', url: '/api/me' });
      expect(res.statusCode).toBe(401);
    } finally {
      await close();
    }
  });

  it('allows authenticated requests and exposes user', async () => {
    const { server, close } = await buildTestServer();
    try {
      const cookie = await loginAndGetCookie(server);
      const res = await server.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ username: 'alice' });
    } finally {
      await close();
    }
  });
});
