import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from '../test-helpers.js';
import { startMockObs } from '../obs/mock-server.js';

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

describe('connections routes — update + delete', () => {
  it('updates an existing connection', async () => {
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const created = await server.inject({
        method: 'POST',
        url: '/api/connections',
        headers: { cookie },
        payload: { name: 'A', host: 'h', port: 4455 },
      });
      const id = created.json().id as string;
      const r = await server.inject({
        method: 'PATCH',
        url: `/api/connections/${id}`,
        headers: { cookie },
        payload: { name: 'B' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ name: 'B' });
    } finally {
      await close();
    }
  });

  it('returns 404 for unknown id', async () => {
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const r = await server.inject({
        method: 'PATCH',
        url: '/api/connections/00000000-0000-0000-0000-000000000000',
        headers: { cookie },
        payload: { name: 'B' },
      });
      expect(r.statusCode).toBe(404);
    } finally {
      await close();
    }
  });

  it('deletes a connection', async () => {
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const created = await server.inject({
        method: 'POST',
        url: '/api/connections',
        headers: { cookie },
        payload: { name: 'A', host: 'h', port: 4455 },
      });
      const id = created.json().id as string;
      const r = await server.inject({
        method: 'DELETE',
        url: `/api/connections/${id}`,
        headers: { cookie },
      });
      expect(r.statusCode).toBe(204);
      const list = await server.inject({
        method: 'GET',
        url: '/api/connections',
        headers: { cookie },
      });
      expect(list.json()).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe('connection /test endpoint', () => {
  it('returns ok for a reachable OBS', async () => {
    const mock = await startMockObs({ password: null });
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const created = await server.inject({
        method: 'POST',
        url: '/api/connections',
        headers: { cookie },
        payload: { name: 'A', host: '127.0.0.1', port: mock.port },
      });
      const id = created.json().id as string;
      const r = await server.inject({
        method: 'POST',
        url: `/api/connections/${id}/test`,
        headers: { cookie },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ status: 'ok' });
    } finally {
      await close();
      await mock.close();
    }
  });

  it('returns auth_failed for wrong password', async () => {
    const mock = await startMockObs({ password: 'real' });
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const created = await server.inject({
        method: 'POST',
        url: '/api/connections',
        headers: { cookie },
        payload: { name: 'A', host: '127.0.0.1', port: mock.port, password: 'wrong' },
      });
      const id = created.json().id as string;
      const r = await server.inject({
        method: 'POST',
        url: `/api/connections/${id}/test`,
        headers: { cookie },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ status: 'auth_failed' });
    } finally {
      await close();
      await mock.close();
    }
  });
});
