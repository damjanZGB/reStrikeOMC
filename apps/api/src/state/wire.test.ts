import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startMockObs, type MockHandle } from '../obs/mock-server.js';
import { ConnectionManager } from '../obs/connection-manager.js';
import { StateStore } from './state-store.js';
import { EventCoalescer } from './event-coalescer.js';
import { wireOBSToState } from './wire.js';

let mock: MockHandle;
let mgr: ConnectionManager;
let store: StateStore;
let coalescer: EventCoalescer;

beforeEach(async () => {
  mock = await startMockObs({ password: null });
  mgr = new ConnectionManager();
  store = new StateStore();
  coalescer = new EventCoalescer((diff) => {
    store.applyDiff(diff);
  });
});

afterEach(async () => {
  coalescer.destroy();
  await mgr.closeAll();
  await mock.close();
});

const ID = '00000000-0000-0000-0000-000000000050';

describe('wireOBSToState', () => {
  it('reflects scene change in StateStore via coalescer', async () => {
    wireOBSToState(mgr, store, coalescer);
    store.upsertConnection(ID);
    await mgr.add({ id: ID, host: '127.0.0.1', port: mock.port, password: null });
    await mgr.waitForStatus(ID, 'connected', 2000);
    mock.changeProgramScene('Scene 2');
    await new Promise((r) => setTimeout(r, 100));
    expect(store.get(ID)?.currentProgramScene).toBe('Scene 2');
  });
});
