import { describe, it, expect } from 'vitest';
import { StateStore } from './state-store.js';

const ID = '00000000-0000-0000-0000-000000000001';

describe('StateStore', () => {
  it('initializes a connection with default state', () => {
    const s = new StateStore();
    s.upsertConnection(ID);
    const snap = s.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.connId).toBe(ID);
    expect(snap[0]!.status).toBe('connecting');
  });

  it('applies a partial diff', () => {
    const s = new StateStore();
    s.upsertConnection(ID);
    s.applyDiff({ connId: ID, status: 'connected', currentProgramScene: 'A' });
    const snap = s.snapshot();
    expect(snap[0]!.status).toBe('connected');
    expect(snap[0]!.currentProgramScene).toBe('A');
  });

  it('removes a connection', () => {
    const s = new StateStore();
    s.upsertConnection(ID);
    s.remove(ID);
    expect(s.snapshot()).toEqual([]);
  });

  it('ignores diff for unknown connection', () => {
    const s = new StateStore();
    s.applyDiff({ connId: ID, status: 'connected' });
    expect(s.snapshot()).toEqual([]);
  });

  it('deep-merges partial outputs (regression: stream toggle clobbered record)', () => {
    const s = new StateStore();
    s.upsertConnection(ID);
    // Establish baseline: streaming + recording both ON.
    s.applyDiff({
      connId: ID,
      outputs: {
        streaming: { active: true, durationMs: 0 },
        recording: { active: true, paused: false, durationMs: 0 },
      },
    });
    expect(s.get(ID)?.outputs.streaming.active).toBe(true);
    expect(s.get(ID)?.outputs.recording.active).toBe(true);

    // A diff for ONLY streaming (e.g. user pressed Stop Streaming).
    // Recording must remain ON — old shallow merge would have dropped it.
    s.applyDiff({
      connId: ID,
      outputs: { streaming: { active: false, durationMs: 0 } },
    });
    const after = s.get(ID)!;
    expect(after.outputs.streaming.active).toBe(false);
    expect(after.outputs.recording.active).toBe(true); // <-- the regression test
    expect(after.outputs.replayBuffer.active).toBe(false);
    expect(after.outputs.virtualCam.active).toBe(false);
  });
});
