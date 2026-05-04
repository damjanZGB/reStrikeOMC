/**
 * Realistic OBS-state scenarios for tests.
 *
 * These exist because the previous test suite always started OBS in a freshly
 * idle state (no scenes, no streams, no inputs). Two real bugs hid behind that:
 * stream-state-on-connect was never observed (Bug A), and the StreamStateChanged
 * translator was clobbering sibling outputs (Bug B). Neither was caught because
 * no test put the mock into "OBS already running" before exercising the code
 * path.
 *
 * Every new integration test should pick one of these scenarios — or compose a
 * new one — instead of starting from `startMockObs({ password: null })` directly,
 * so the test's setup matches a real-world condition a user would actually hit.
 */
import { startMockObs, type MockHandle } from './mock-server.js';

export interface ScenarioOpts {
  password?: string | null;
}

/** Freshly-idle OBS. No scenes, default Mic input. Use for tightly-scoped unit tests. */
export async function obsIdle(opts: ScenarioOpts = {}): Promise<MockHandle> {
  return startMockObs({ password: opts.password ?? null });
}

/** OBS that's currently live-streaming. Two scenes, single mic. The most common
 *  state in production — a tournament floor with a long-running stream. */
export async function obsStreamingOnly(opts: ScenarioOpts = {}): Promise<MockHandle> {
  const mock = await startMockObs({ password: opts.password ?? null });
  mock.setSceneList(['Live', 'Halftime']);
  mock.setOutputs({ streaming: true });
  return mock;
}

/** OBS recording locally without streaming. Common at events that record-only
 *  for later VOD upload. */
export async function obsRecordingOnly(opts: ScenarioOpts = {}): Promise<MockHandle> {
  const mock = await startMockObs({ password: opts.password ?? null });
  mock.setSceneList(['Stage A', 'Stage B']);
  mock.setOutputs({ recording: true });
  return mock;
}

/** OBS that's both streaming AND recording — the scenario where Bug B
 *  manifested most visibly: a stream-toggle event clobbered the recording
 *  flag, making the dashboard wrong about whether the local recording was
 *  still going. */
export async function obsRunningProduction(opts: ScenarioOpts = {}): Promise<MockHandle> {
  const mock = await startMockObs({ password: opts.password ?? null });
  mock.setSceneList(['Live', 'BRB', 'Outro']);
  mock.setInputList([
    { name: 'Mic', kind: 'wasapi_input_capture' },
    { name: 'Camera', kind: 'dshow_input' },
    { name: 'Game', kind: 'window_capture' },
  ]);
  mock.setOutputs({ streaming: true, recording: true });
  return mock;
}

/** All four outputs running at once. Stress test for the per-output merge —
 *  any sibling-clobber bug shows immediately. */
export async function obsAllOutputs(opts: ScenarioOpts = {}): Promise<MockHandle> {
  const mock = await startMockObs({ password: opts.password ?? null });
  mock.setSceneList(['Main']);
  mock.setOutputs({
    streaming: true,
    recording: true,
    replayBuffer: true,
    virtualCam: true,
  });
  return mock;
}
