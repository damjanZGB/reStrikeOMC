/**
 * End-to-end tests phrased as user-facing scenarios.
 *
 * These tests would have caught Bug A (stream state always off on connect) and
 * Bug B (output event clobbered siblings) BEFORE they shipped. Each test starts
 * with "given OBS is in state X" not "given the mock is freshly initialized",
 * and asserts on the user-visible contract (what the StateStore reports / what
 * the WS broadcasts) rather than on the mechanism (what function returned).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from './connection-manager.js';
import { StateStore } from '../state/state-store.js';
import { EventCoalescer } from '../state/event-coalescer.js';
import { wireOBSToState } from '../state/wire.js';
import {
  obsStreamingOnly,
  obsRecordingOnly,
  obsRunningProduction,
  obsAllOutputs,
} from './scenarios.js';
import type { MockHandle } from './mock-server.js';

let mock: MockHandle;
let mgr: ConnectionManager;
let store: StateStore;
let coalescer: EventCoalescer;

beforeEach(() => {
  mgr = new ConnectionManager();
  store = new StateStore();
  coalescer = new EventCoalescer((diff) => {
    store.applyDiff(diff);
  });
  wireOBSToState(mgr, store, coalescer);
});

afterEach(async () => {
  coalescer.destroy();
  await mgr.closeAll();
  if (mock) await mock.close();
});

const ID = '00000000-0000-0000-0000-000000000a01';

async function settle(): Promise<void> {
  // Give the snapshot fetch + coalescer flush a tick to land in the store.
  await new Promise((r) => setTimeout(r, 150));
}

describe('user scenario: OBS already streaming when I open the dashboard', () => {
  it('the StateStore reflects the live stream as active, not the default off', async () => {
    mock = await obsStreamingOnly();
    store.upsertConnection(ID);
    await mgr.add({ id: ID, host: '127.0.0.1', port: mock.port, password: null });
    await mgr.waitForStatus(ID, 'connected', 2000);
    await settle();

    const live = store.get(ID)!;
    expect(live.outputs.streaming.active).toBe(true);
    // The other three must be off — explicit assertion so a future regression
    // that defaults siblings to true would fail loudly.
    expect(live.outputs.recording.active).toBe(false);
    expect(live.outputs.replayBuffer.active).toBe(false);
    expect(live.outputs.virtualCam.active).toBe(false);
  });
});

describe('user scenario: OBS is recording (not streaming) when I open the dashboard', () => {
  it('the StateStore reflects recording as active, all others off', async () => {
    mock = await obsRecordingOnly();
    store.upsertConnection(ID);
    await mgr.add({ id: ID, host: '127.0.0.1', port: mock.port, password: null });
    await mgr.waitForStatus(ID, 'connected', 2000);
    await settle();

    const live = store.get(ID)!;
    expect(live.outputs.recording.active).toBe(true);
    expect(live.outputs.streaming.active).toBe(false);
    expect(live.outputs.replayBuffer.active).toBe(false);
    expect(live.outputs.virtualCam.active).toBe(false);
  });
});

describe('user scenario: OBS is streaming AND recording, then I stop the stream', () => {
  it('only streaming flips to off — recording stays on (Bug B regression)', async () => {
    mock = await obsRunningProduction();
    store.upsertConnection(ID);
    await mgr.add({ id: ID, host: '127.0.0.1', port: mock.port, password: null });
    await mgr.waitForStatus(ID, 'connected', 2000);
    await settle();

    // Baseline: both on (this is the Bug A regression — must observe at all).
    expect(store.get(ID)!.outputs.streaming.active).toBe(true);
    expect(store.get(ID)!.outputs.recording.active).toBe(true);

    // Now simulate the user stopping the stream on OBS itself. obs-websocket-js
    // will receive a StreamStateChanged event with outputActive=false.
    // We can fake this by feeding the coalescer a synthesised event — same
    // path the real obsEvent listener takes.
    coalescer.handle(ID, 'StreamStateChanged', { outputActive: false });
    await settle();

    const after = store.get(ID)!;
    expect(after.outputs.streaming.active).toBe(false);
    // Bug B: this used to flip back to false because the StreamStateChanged
    // diff overwrote the entire outputs block. With per-key merge, recording
    // is preserved.
    expect(after.outputs.recording.active).toBe(true);
  });
});

describe('user scenario: OBS has all four outputs running', () => {
  it('every output is reported as active in the snapshot', async () => {
    mock = await obsAllOutputs();
    store.upsertConnection(ID);
    await mgr.add({ id: ID, host: '127.0.0.1', port: mock.port, password: null });
    await mgr.waitForStatus(ID, 'connected', 2000);
    await settle();

    const out = store.get(ID)!.outputs;
    expect(out.streaming.active).toBe(true);
    expect(out.recording.active).toBe(true);
    expect(out.replayBuffer.active).toBe(true);
    expect(out.virtualCam.active).toBe(true);
  });

  it('toggling each output one at a time preserves the others', async () => {
    mock = await obsAllOutputs();
    store.upsertConnection(ID);
    await mgr.add({ id: ID, host: '127.0.0.1', port: mock.port, password: null });
    await mgr.waitForStatus(ID, 'connected', 2000);
    await settle();

    // Stop the stream: every other output must remain on.
    coalescer.handle(ID, 'StreamStateChanged', { outputActive: false });
    await settle();
    let s = store.get(ID)!.outputs;
    expect(s.streaming.active).toBe(false);
    expect(s.recording.active).toBe(true);
    expect(s.replayBuffer.active).toBe(true);
    expect(s.virtualCam.active).toBe(true);

    // Stop the recording: streaming stays off, replay+virtualCam still on.
    coalescer.handle(ID, 'RecordStateChanged', {
      outputActive: false,
      outputPaused: false,
    });
    await settle();
    s = store.get(ID)!.outputs;
    expect(s.streaming.active).toBe(false);
    expect(s.recording.active).toBe(false);
    expect(s.replayBuffer.active).toBe(true);
    expect(s.virtualCam.active).toBe(true);

    // Stop replay: only virtualCam left on.
    coalescer.handle(ID, 'ReplayBufferStateChanged', { outputActive: false });
    await settle();
    s = store.get(ID)!.outputs;
    expect(s.replayBuffer.active).toBe(false);
    expect(s.virtualCam.active).toBe(true);

    // Stop virtualcam: all four off.
    coalescer.handle(ID, 'VirtualcamStateChanged', { outputActive: false });
    await settle();
    s = store.get(ID)!.outputs;
    expect(s.virtualCam.active).toBe(false);
    expect(s.streaming.active).toBe(false);
    expect(s.recording.active).toBe(false);
    expect(s.replayBuffer.active).toBe(false);
  });
});

describe('user scenario: OBS scene/input list reflects production setup', () => {
  it('snapshot reports the configured scenes and inputs (not just the defaults)', async () => {
    mock = await obsRunningProduction();
    store.upsertConnection(ID);
    await mgr.add({ id: ID, host: '127.0.0.1', port: mock.port, password: null });
    await mgr.waitForStatus(ID, 'connected', 2000);
    await settle();

    const live = store.get(ID)!;
    expect(live.scenes.map((s) => s.name)).toEqual(['Live', 'BRB', 'Outro']);
    expect(live.inputs.map((i) => i.name)).toEqual(['Mic', 'Camera', 'Game']);
  });
});
