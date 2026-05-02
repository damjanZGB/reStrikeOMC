import { describe, it, expect } from 'vitest';
import { buildTestServer } from './test-helpers.js';

describe('apps/api smoke', () => {
  it('boots a Fastify server with /health endpoint', async () => {
    const { server, close } = await buildTestServer();
    try {
      const res = await server.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    } finally {
      await close();
    }
  });
});
