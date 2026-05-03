import type { InstanceState, InstanceStateDiff } from '@restrike/shared';

function defaultState(connId: string): InstanceState {
  return {
    connId,
    status: 'connecting',
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
  };
}

export class StateStore {
  private readonly states = new Map<string, InstanceState>();

  upsertConnection(connId: string): void {
    if (!this.states.has(connId)) {
      this.states.set(connId, defaultState(connId));
    }
  }

  applyDiff(diff: InstanceStateDiff): InstanceState | null {
    const current = this.states.get(diff.connId);
    if (!current) return null;
    const merged: InstanceState = { ...current, ...diff, connId: current.connId };
    this.states.set(diff.connId, merged);
    return merged;
  }

  remove(connId: string): void {
    this.states.delete(connId);
  }

  snapshot(): InstanceState[] {
    return Array.from(this.states.values());
  }

  get(connId: string): InstanceState | null {
    return this.states.get(connId) ?? null;
  }
}
