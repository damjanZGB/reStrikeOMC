import { describe, it, expect, beforeEach } from 'vitest';
import type { InstanceState, InstanceStateDiff } from '@restrike/shared';
import { useWsStore } from './use-ws';

function makeState(connId: string, overrides: Partial<InstanceState> = {}): InstanceState {
  return {
    connId,
    status: 'connected',
    currentProgramScene: null,
    currentPreviewScene: null,
    studioMode: false,
    scenes: [],
    inputs: [],
    outputs: {
      streaming: { active: false, durationMs: 0 },
      recording: { active: false, paused: false, durationMs: 0 },
      replayBuffer: { active: false },
      virtualCam: { active: false },
    },
    stats: null,
    ...overrides,
  };
}

describe('useWsStore', () => {
  beforeEach(() => {
    useWsStore.setState({ connected: false, states: {}, pending: new Map() });
  });

  it('applies a snapshot keyed by connId', () => {
    const a = makeState('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', { currentProgramScene: 'A' });
    const b = makeState('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', { currentProgramScene: 'B' });
    useWsStore.getState().applySnapshot([a, b]);
    const states = useWsStore.getState().states;
    expect(Object.keys(states)).toHaveLength(2);
    expect(states[a.connId]?.currentProgramScene).toBe('A');
    expect(states[b.connId]?.currentProgramScene).toBe('B');
  });

  it('snapshot replaces, does not merge with previous', () => {
    const a = makeState('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    const b = makeState('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    useWsStore.getState().applySnapshot([a, b]);
    useWsStore.getState().applySnapshot([a]);
    expect(Object.keys(useWsStore.getState().states)).toEqual([a.connId]);
  });

  it('applies a diff to an existing connection', () => {
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    useWsStore.getState().applySnapshot([makeState(id, { currentProgramScene: 'A' })]);
    const diff: InstanceStateDiff = { connId: id, currentProgramScene: 'B' };
    useWsStore.getState().applyDiff(diff);
    expect(useWsStore.getState().states[id]?.currentProgramScene).toBe('B');
  });

  it('ignores diff for unknown connId (matches StateStore semantics)', () => {
    useWsStore.getState().applyDiff({
      connId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      status: 'connected',
    });
    expect(Object.keys(useWsStore.getState().states)).toHaveLength(0);
  });

  it('preserves other fields when applying a partial diff', () => {
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    useWsStore.getState().applySnapshot([
      makeState(id, {
        currentProgramScene: 'A',
        scenes: [{ name: 'A', index: 0 }],
      }),
    ]);
    useWsStore.getState().applyDiff({ connId: id, currentProgramScene: 'B' });
    const after = useWsStore.getState().states[id];
    expect(after?.currentProgramScene).toBe('B');
    expect(after?.scenes).toEqual([{ name: 'A', index: 0 }]);
  });
});
