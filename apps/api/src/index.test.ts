import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from './index.js';
import { buildTestServer } from './test-helpers.js';
import { startMockObs } from './obs/mock-server.js';

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

  it('hydrates the ConnectionManager from persisted connections on boot', async () => {
    // Persist a connection via one server instance, then reboot a fresh
    // server pointed at the same DB and assert the manager dialed it.
    const mock = await startMockObs({ password: null });
    const dir = mkdtempSync(join(tmpdir(), 'restrike-hydrate-'));
    const dbPath = join(dir, 'test.db');
    const opts = {
      test: true as const,
      dbPath,
      sessionSecret: 'a'.repeat(32),
      connectionPasswordKey: 'b'.repeat(32),
    };
    let connId: string;
    {
      const first = await buildServer(opts);
      try {
        await first.inject({
          method: 'POST',
          url: '/api/setup',
          payload: { username: 'a', password: 'longenoughpw' },
        });
        const login = await first.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'a', password: 'longenoughpw' },
        });
        const cookie = String(login.headers['set-cookie']).split(';')[0] ?? '';
        const created = await first.inject({
          method: 'POST',
          url: '/api/connections',
          headers: { cookie },
          payload: { name: 'persisted', host: '127.0.0.1', port: mock.port },
        });
        connId = created.json().id as string;
      } finally {
        await first.close();
      }
    }
    // Fresh boot — same DB, no in-memory state from previous run.
    const second = await buildServer(opts);
    try {
      await second.obsManager.waitForStatus(connId!, 'connected', 5000);
      expect(second.obsManager.getStatus(connId!)).toBe('connected');
    } finally {
      await second.close();
      await mock.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
