/**
 * Audio-pipeline scenario tests.
 *
 * Each test starts from a realistic OBS state ("Mic is muted, Camera at -6 dB,
 * meters streaming at 30 Hz"), then asserts on the user-visible contract: what
 * does StateStore.get(connId) report?
 *
 * These tests exist because the dashboard was showing every audio source at
 * 100% unmuted regardless of the real OBS state. Four interrelated bugs hid
 * behind that symptom — see comments below for which test pins which bug.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from './connection-manager.js';
import { StateStore } from '../state/state-store.js';
import { EventCoalescer } from '../state/event-coalescer.js';
import { wireOBSToState } from '../state/wire.js';
import { obsRunningProduction } from './scenarios.js';
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

const ID = '00000000-0000-0000-0000-000000000a02';

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 200));
}

async function connect(): Promise<void> {
  store.upsertConnection(ID);
  await mgr.add({ id: ID, host: '127.0.0.1', port: mock.port, password: null });
  await mgr.waitForStatus(ID, 'connected', 2000);
  await settle();
}

describe('user scenario: OBS reports muted and lowered inputs when I open the dashboard', () => {
  it('snapshot reflects mute and volume per input — not hardcoded defaults (Bug B audio regression)', async () => {
    mock = await obsRunningProduction();
    // Mic muted, Camera at half-volume (-6 dB), Game default
    mock.setInputMute('Mic', true);
    mock.setInputVolume('Camera', { mul: 0.5, db: -6 });
    await connect();

    const live = store.get(ID)!;
    const mic = live.inputs.find((i) => i.name === 'Mic')!;
    const camera = live.inputs.find((i) => i.name === 'Camera')!;
    const game = live.inputs.find((i) => i.name === 'Game')!;

    expect(mic).toBeDefined();
    expect(mic.muted).toBe(true);
    expect(mic.volumeMul).toBeCloseTo(1.0, 2);

    expect(camera.muted).toBe(false);
    expect(camera.volumeMul).toBeCloseTo(0.5, 2);
    expect(camera.volumeDb).toBeCloseTo(-6, 1);

    expect(game.muted).toBe(false);
    expect(game.volumeMul).toBeCloseTo(1.0, 2);
  });
});

describe('user scenario: I mute Mic on OBS while Camera is at half-volume', () => {
  it('only Mic flips to muted — Camera volume is preserved (Bug A audio regression + per-input merge)', async () => {
    mock = await obsRunningProduction();
    mock.setInputVolume('Camera', { mul: 0.5, db: -6 });
    await connect();

    // Baseline: Camera reflects the lowered volume
    const before = store.get(ID)!;
    expect(before.inputs.find((i) => i.name === 'Camera')!.volumeMul).toBeCloseTo(0.5, 2);

    // OBS emits InputMuteStateChanged for Mic only
    coalescer.handle(ID, 'InputMuteStateChanged', { inputName: 'Mic', inputMuted: true });
    await settle();

    const after = store.get(ID)!;
    expect(after.inputs.find((i) => i.name === 'Mic')!.muted).toBe(true);
    // Sibling preserved — was being clobbered to default (mul=1) by old translator
    expect(after.inputs.find((i) => i.name === 'Camera')!.volumeMul).toBeCloseTo(0.5, 2);
    expect(after.inputs.find((i) => i.name === 'Camera')!.muted).toBe(false);
    expect(after.inputs.find((i) => i.name === 'Game')!.muted).toBe(false);
  });
});

describe('user scenario: InputVolumeMeters arrives ~30 times per second', () => {
  it('high-frequency meter events do NOT overwrite muted/volumeMul (Bug D regression)', async () => {
    mock = await obsRunningProduction();
    mock.setInputMute('Mic', true);
    mock.setInputVolume('Camera', { mul: 0.5, db: -6 });
    await connect();

    // A single meter event arrives — old code returned a full InputState with
    // muted=false, volumeMul=0, which would clobber the real values 30×/sec.
    coalescer.handle(ID, 'InputVolumeMeters', {
      inputs: [
        { inputName: 'Mic', inputLevelsMul: [[0.001, 0.002, 0.003]] },
        { inputName: 'Camera', inputLevelsMul: [[0.4, 0.5, 0.6]] },
      ],
    });
    await settle();

    const live = store.get(ID)!;
    const mic = live.inputs.find((i) => i.name === 'Mic')!;
    const camera = live.inputs.find((i) => i.name === 'Camera')!;

    // Mute and volume must be preserved — the meter only carries level data.
    expect(mic.muted).toBe(true);
    expect(camera.volumeMul).toBeCloseTo(0.5, 2);

    // Levels must be populated.
    const micCh = mic.levels[0]!;
    const camCh = camera.levels[0]!;
    expect(micCh.current).toBeCloseTo(0.001, 4);
    expect(micCh.average).toBeCloseTo(0.002, 4);
    expect(micCh.peak).toBeCloseTo(0.003, 4);
    expect(camCh.current).toBeCloseTo(0.4, 2);
  });
});

describe('user scenario: meter events flow over the live websocket', () => {
  it('mock-emitted InputVolumeMeters lands in store as input.levels (Bug C — meter subscription)', async () => {
    mock = await obsRunningProduction();
    await connect();

    // The mock simulates OBS sending meter data over the wire. If our client
    // never subscribed to the high-volume InputVolumeMeters event, this will
    // not arrive at the coalescer at all.
    mock.emitMeters({
      Mic: [[0.001, 0.002, 0.003]],
      Camera: [[0.4, 0.5, 0.6]],
    });
    // Meter events are low-priority and coalesce — wait beyond the 33 ms flush.
    await settle();

    const live = store.get(ID)!;
    const mic = live.inputs.find((i) => i.name === 'Mic')!;
    expect(mic.levels.length).toBeGreaterThan(0);
    expect(mic.levels[0]!.current).toBeCloseTo(0.001, 4);
  });
});
