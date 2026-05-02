import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startMockObs, type MockHandle } from './mock-server.js';
import { ConnectionManager } from './connection-manager.js';

let mock: MockHandle;
let mgr: ConnectionManager;

beforeEach(async () => {
  mock = await startMockObs({ password: null });
  mgr = new ConnectionManager();
});

afterEach(async () => {
  await mgr.closeAll();
  await mock.close();
});

describe('ConnectionManager — lifecycle', () => {
  it('opens a connection and reaches "connected"', async () => {
    const stateChanges: string[] = [];
    mgr.on('status', (e) => stateChanges.push(`${e.connId}:${e.status}`));
    await mgr.add({
      id: '00000000-0000-0000-0000-000000000001',
      host: '127.0.0.1',
      port: mock.port,
      password: null,
    });
    await mgr.waitForStatus('00000000-0000-0000-0000-000000000001', 'connected', 2000);
    expect(stateChanges).toContain('00000000-0000-0000-0000-000000000001:connecting');
    expect(stateChanges).toContain('00000000-0000-0000-0000-000000000001:connected');
  });

  it('classifies bad password as auth_failed and stops reconnect', async () => {
    await mock.close();
    mock = await startMockObs({ password: 'real' });
    await mgr.add({
      id: '00000000-0000-0000-0000-000000000002',
      host: '127.0.0.1',
      port: mock.port,
      password: 'wrong',
    });
    await mgr.waitForStatus('00000000-0000-0000-0000-000000000002', 'auth_failed', 2000);
    expect(mgr.getStatus('00000000-0000-0000-0000-000000000002')).toBe('auth_failed');
  });
});
