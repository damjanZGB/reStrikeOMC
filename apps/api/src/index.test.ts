import { describe, it, expect } from 'vitest';
import { buildServer } from './index.js';

describe('apps/api smoke', () => {
  it('boots a Fastify server with /health endpoint', async () => {
    const server = await buildServer({ test: true });
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await server.close();
  });
});
