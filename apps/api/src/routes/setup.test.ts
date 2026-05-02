import { describe, it, expect } from 'vitest';
import { buildTestServer } from '../test-helpers.js';

describe('POST /api/setup', () => {
  it('creates first user when DB has no users', async () => {
    const { server, close } = await buildTestServer();
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/setup',
        payload: { username: 'alice', password: 'longenoughpw' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ username: 'alice' });
    } finally {
      await close();
    }
  });

  it('rejects setup once a user exists', async () => {
    const { server, close } = await buildTestServer();
    try {
      await server.inject({
        method: 'POST',
        url: '/api/setup',
        payload: { username: 'alice', password: 'longenoughpw' },
      });
      const res = await server.inject({
        method: 'POST',
        url: '/api/setup',
        payload: { username: 'bob', password: 'longenoughpw' },
      });
      expect(res.statusCode).toBe(409);
    } finally {
      await close();
    }
  });

  it('rejects short passwords', async () => {
    const { server, close } = await buildTestServer();
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/setup',
        payload: { username: 'alice', password: 'short' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await close();
    }
  });
});
