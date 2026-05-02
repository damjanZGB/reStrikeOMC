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

describe('ConnectionManager — initial sync', () => {
  it('emits a snapshot event with scenes and inputs after connect', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = [];
    mgr.on('snapshot', (e) => events.push(e));
    mock.setSceneList(['A', 'B']);
    mock.setInputList([{ name: 'Mic', kind: 'wasapi_input_capture' }]);
    await mgr.add({
      id: '00000000-0000-0000-0000-000000000010',
      host: '127.0.0.1',
      port: mock.port,
      password: null,
    });
    await mgr.waitForStatus('00000000-0000-0000-0000-000000000010', 'connected', 2000);
    await new Promise((r) => setTimeout(r, 100));
    const snap = events.find((e) => e.connId === '00000000-0000-0000-0000-000000000010');
    expect(snap).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(snap.scenes.map((s: any) => s.name)).toEqual(['A', 'B']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(snap.inputs.map((i: any) => i.name)).toEqual(['Mic']);
  });
});
