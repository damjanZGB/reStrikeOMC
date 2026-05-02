import { describe, it, expect } from 'vitest';
import { buildTestServer } from '../test-helpers.js';
import type { FastifyInstance } from 'fastify';

async function setup(server: FastifyInstance): Promise<void> {
  await server.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { username: 'alice', password: 'longenoughpw' },
  });
}

describe('POST /api/auth/login', () => {
  it('logs in valid user and sets a session cookie', async () => {
    const { server, close } = await buildTestServer();
    try {
      await setup(server);
      const res = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'alice', password: 'longenoughpw' },
      });
      expect(res.statusCode).toBe(200);
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      expect(String(setCookie)).toMatch(/restrike_sess=/);
      expect(String(setCookie)).toMatch(/HttpOnly/);
    } finally {
      await close();
    }
  });

  it('rejects wrong password', async () => {
    const { server, close } = await buildTestServer();
    try {
      await setup(server);
      const res = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'alice', password: 'wrong' },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await close();
    }
  });
});

describe('POST /api/auth/logout', () => {
  it('clears session cookie', async () => {
    const { server, close } = await buildTestServer();
    try {
      await setup(server);
      const login = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'alice', password: 'longenoughpw' },
      });
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      const res = await server.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['set-cookie'])).toMatch(/restrike_sess=;/);
    } finally {
      await close();
    }
  });
});
