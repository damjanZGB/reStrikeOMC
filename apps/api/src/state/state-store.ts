import type {
  InstanceState,
  InstanceStateDiff,
  OutputSnapshotPartial,
} from '@restrike/shared';

function mergeOutputs(
  current: InstanceState['outputs'],
  partial: OutputSnapshotPartial
): InstanceState['outputs'] {
  // Per-key nullish-coalesce: an absent OR explicitly-undefined sub-key
  // keeps the current value, which prevents a single output event (e.g.
  // StreamStateChanged) from clobbering its three siblings to defaults.
  return {
    streaming: partial.streaming ?? current.streaming,
    recording: partial.recording ?? current.recording,
    replayBuffer: partial.replayBuffer ?? current.replayBuffer,
    virtualCam: partial.virtualCam ?? current.virtualCam,
  };
}

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
    // Most diff fields shallow-overwrite. `outputs` is the exception — see
    // mergeOutputs for why a per-key merge matters.
    const merged: InstanceState = {
      ...current,
      ...diff,
      connId: current.connId,
      outputs: diff.outputs ? mergeOutputs(current.outputs, diff.outputs) : current.outputs,
    };
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
