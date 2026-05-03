import { describe, it, expect } from 'vitest';
import { InstanceStateSchema, ConnectionStatusSchema } from './state.js';

describe('state schemas', () => {
  it('parses a fully populated instance state', () => {
    const state = {
      connId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'connected',
      currentProgramScene: 'Scene 1',
      currentPreviewScene: null,
      studioMode: false,
      scenes: [{ name: 'Scene 1', index: 0 }],
      inputs: [
        {
          name: 'Mic',
          kind: 'wasapi_input_capture',
          muted: false,
          volumeDb: -6.0,
          volumeMul: 0.5,
          syncOffsetMs: 0,
          levels: [],
        },
      ],
      outputs: {
        streaming: { active: false, durationMs: 0 },
        recording: { active: false, paused: false, durationMs: 0 },
        replayBuffer: { active: false },
        virtualCam: { active: false },
      },
      stats: null,
    };
    expect(InstanceStateSchema.parse(state)).toEqual(state);
  });

  it('rejects unknown status values', () => {
    expect(() =>
      ConnectionStatusSchema.parse('exploded')
    ).toThrow();
  });
});
