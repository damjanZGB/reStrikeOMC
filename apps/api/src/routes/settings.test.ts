import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from '../test-helpers.js';
import { startMockObs } from '../obs/mock-server.js';
import { startMockObsV4 } from '../obs/mock-server-v4.js';

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

describe('GET /api/settings', () => {
  it('rejects unauthenticated requests', async () => {
    const { server, close } = await buildTestServer();
    try {
      const r = await server.inject({ method: 'GET', url: '/api/settings' });
      expect(r.statusCode).toBe(401);
    } finally {
      await close();
    }
  });

  it('returns the seeded default protocol v5', async () => {
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const r = await server.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { cookie },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ defaultProtocol: 'v5' });
    } finally {
      await close();
    }
  });
});

describe('PUT /api/settings', () => {
  it('persists a new defaultProtocol', async () => {
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const put = await server.inject({
        method: 'PUT',
        url: '/api/settings',
        headers: { cookie },
        payload: { defaultProtocol: 'v4' },
      });
      expect(put.statusCode).toBe(204);
      const got = await server.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { cookie },
      });
      expect(got.json()).toEqual({ defaultProtocol: 'v4' });
    } finally {
      await close();
    }
  });

  it('rejects invalid protocol values', async () => {
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const r = await server.inject({
        method: 'PUT',
        url: '/api/settings',
        headers: { cookie },
        payload: { defaultProtocol: 'v6' },
      });
      expect(r.statusCode).toBe(400);
    } finally {
      await close();
    }
  });
});

describe('protocol round-trip through /api/connections', () => {
  it('POST accepts explicit protocol and returns it on GET', async () => {
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const created = await server.inject({
        method: 'POST',
        url: '/api/connections',
        headers: { cookie },
        payload: { name: 'Legacy', host: '10.0.0.7', port: 4444, protocol: 'v4' },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().protocol).toBe('v4');

      const list = await server.inject({
        method: 'GET',
        url: '/api/connections',
        headers: { cookie },
      });
      expect(list.json()[0].protocol).toBe('v4');
    } finally {
      await close();
    }
  });

  it('PATCH updates protocol from v5 to v4', async () => {
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
      expect(created.json().protocol).toBeNull();
      const patched = await server.inject({
        method: 'PATCH',
        url: `/api/connections/${id}`,
        headers: { cookie },
        payload: { protocol: 'v4' },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().protocol).toBe('v4');
    } finally {
      await close();
    }
  });

  it('GET defaults protocol to null when not provided on create', async () => {
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      await server.inject({
        method: 'POST',
        url: '/api/connections',
        headers: { cookie },
        payload: { name: 'A', host: 'h', port: 4455 },
      });
      const list = await server.inject({
        method: 'GET',
        url: '/api/connections',
        headers: { cookie },
      });
      expect(list.json()[0].protocol).toBeNull();
    } finally {
      await close();
    }
  });
});

// P0-5: end-to-end test that PATCHing the protocol field actually switches
// the live socket to the new wire format. The settings tests above prove
// only that the DB row changed — they would not catch a regression where
// `manager.remove()` then `manager.add()` accidentally reused the old
// slot's client class. This test connects to a v5 mock, PATCHes to v4
// against a v4 mock on a different port, and asserts the v4 mock received
// the v4-vocab request name (`SetCurrentScene`) — proving the wire format
// switched, not just the metadata.
describe('PATCH /api/connections/:id with new protocol triggers wire-level reconnect', () => {
  it('switches from v5 to v4 and round-trips a command on the v4 wire', async () => {
    const mockV5 = await startMockObs({ password: null });
    const mockV4 = await startMockObsV4({ password: null });
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      // 1. Create a v5 connection pointed at the v5 mock.
      const created = await server.inject({
        method: 'POST',
        url: '/api/connections',
        headers: { cookie },
        payload: {
          name: 'switcher',
          host: '127.0.0.1',
          port: mockV5.port,
          protocol: 'v5',
        },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().id as string;
      await server.obsManager.waitForStatus(id, 'connected', 3000);

      // 2. PATCH to v4, retargeting at the v4 mock.
      const patched = await server.inject({
        method: 'PATCH',
        url: `/api/connections/${id}`,
        headers: { cookie },
        payload: { port: mockV4.port, protocol: 'v4' },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().protocol).toBe('v4');

      // 3. The manager must reach 'connected' against the v4 mock.
      await server.obsManager.waitForStatus(id, 'connected', 5000);

      // 4. Round-trip the internal-vocab SetCurrentProgramScene. If the slot
      //    still spoke v5, the v4 mock would have received nothing on the v4
      //    wire. Asserting the v4-vocab request name proves the translator
      //    is in the path.
      await server.obsManager.call(id, 'SetCurrentProgramScene', {
        sceneName: 'Scene 2',
      });
      const sawSetCurrentScene = mockV4.receivedRequests.some(
        (r) => r.requestType === 'SetCurrentScene'
      );
      expect(sawSetCurrentScene).toBe(true);
    } finally {
      await close();
      await mockV5.close();
      await mockV4.close();
    }
  }, 15_000);
});

// P1-6: prove that persisted v4 rows are correctly hydrated on a fresh
// server boot. Without this test, a regression in index.ts's hydration
// loop (e.g. a refactor that resolved protocol before reading the row)
// would manifest as "all my v4 tiles are silently disconnected after
// restart". We seed the DB via one buildTestServer call, close it, then
// build another against the same dbPath and assert both mock-targeted
// connections reach 'connected'.
describe('boot-time hydration of mixed v4 + v5 connections (P1-6)', () => {
  it('reconnects both protocols against their mocks on a fresh server boot', async () => {
    const mockV5 = await startMockObs({ password: null });
    const mockV4 = await startMockObsV4({ password: null });
    const dir = mkdtempSync(join(tmpdir(), 'restrike-hydrate-'));
    const dbPath = join(dir, 'test.db');
    let v5Id = '';
    let v4Id = '';
    try {
      // Phase 1: create connections via API on a temporary server.
      {
        const { server, close } = await buildTestServer({ dbPath });
        const cookie = await login(server);
        const r5 = await server.inject({
          method: 'POST',
          url: '/api/connections',
          headers: { cookie },
          payload: {
            name: 'v5-row',
            host: '127.0.0.1',
            port: mockV5.port,
            protocol: 'v5',
          },
        });
        v5Id = r5.json().id as string;
        const r4 = await server.inject({
          method: 'POST',
          url: '/api/connections',
          headers: { cookie },
          payload: {
            name: 'v4-row',
            host: '127.0.0.1',
            port: mockV4.port,
            protocol: 'v4',
          },
        });
        v4Id = r4.json().id as string;
        await server.obsManager.waitForStatus(v5Id, 'connected', 3000);
        await server.obsManager.waitForStatus(v4Id, 'connected', 3000);
        await close();
      }
      // Phase 2: spin up a new server against the same DB. The boot
      // hydration loop must rehydrate both connections from the persisted
      // rows and reach 'connected' on both.
      {
        const { server, close } = await buildTestServer({ dbPath });
        try {
          await server.obsManager.waitForStatus(v5Id, 'connected', 5000);
          await server.obsManager.waitForStatus(v4Id, 'connected', 5000);
          // Round-trip a call through each to prove the wire actually works.
          await server.obsManager.call(v5Id, 'SetCurrentProgramScene', {
            sceneName: 'Scene 2',
          });
          await server.obsManager.call(v4Id, 'SetCurrentProgramScene', {
            sceneName: 'Scene 2',
          });
        } finally {
          await close();
        }
      }
      const sawV4Translation = mockV4.receivedRequests.some(
        (r) => r.requestType === 'SetCurrentScene'
      );
      expect(sawV4Translation).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await mockV5.close();
      await mockV4.close();
    }
  }, 30_000);
});

// P1-11: /api/connections/:id/test must route v4 auth failures to the
// 'auth_failed' branch. The route's error-handling uses
// `err instanceof AuthFailedError`; refactoring the AuthFailedError
// location would silently break that detection.
describe('/api/connections/:id/test against a v4 server (P1-11)', () => {
  it('returns ok for a reachable v4 OBS', async () => {
    const mockV4 = await startMockObsV4({ password: null });
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const created = await server.inject({
        method: 'POST',
        url: '/api/connections',
        headers: { cookie },
        payload: {
          name: 'v4-test',
          host: '127.0.0.1',
          port: mockV4.port,
          protocol: 'v4',
        },
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
      await mockV4.close();
    }
  });

  it('returns auth_failed for wrong password against v4', async () => {
    const mockV4 = await startMockObsV4({ password: 'real' });
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const created = await server.inject({
        method: 'POST',
        url: '/api/connections',
        headers: { cookie },
        payload: {
          name: 'v4-bad-pw',
          host: '127.0.0.1',
          port: mockV4.port,
          password: 'wrong',
          protocol: 'v4',
        },
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
      await mockV4.close();
    }
  });
});

// P2-15: integration test for ConnectionManager.call() against a v4 slot.
// Phase B unit-tested the v4 client end-to-end and Phase E unit-tested the
// translation pure functions, but no test wires the manager → v4 client
// → mock chain to verify a v4 slot answers manager-level calls. A
// regression in createObsClient (e.g. returning v5 client for protocol
// 'v4') would otherwise ship invisibly.
describe('ConnectionManager.call() against a v4 slot (P2-15)', () => {
  it('routes the call through the v4 translator', async () => {
    const mockV4 = await startMockObsV4({ password: null });
    const { server, close } = await buildTestServer();
    try {
      const cookie = await login(server);
      const created = await server.inject({
        method: 'POST',
        url: '/api/connections',
        headers: { cookie },
        payload: {
          name: 'v4-manager-call',
          host: '127.0.0.1',
          port: mockV4.port,
          protocol: 'v4',
        },
      });
      const id = created.json().id as string;
      await server.obsManager.waitForStatus(id, 'connected', 3000);
      await server.obsManager.call(id, 'SetInputMute', {
        inputName: 'Mic',
        muted: true,
      });
      const sawTranslated = mockV4.receivedRequests.some(
        (r) => r.requestType === 'SetMute'
      );
      expect(sawTranslated).toBe(true);
    } finally {
      await close();
      await mockV4.close();
    }
  });
});
