import type {
  InstanceState,
  InstanceStateDiff,
  InputState,
  InputStatePartial,
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

function defaultInput(name: string): InputState {
  return {
    name,
    kind: '',
    muted: false,
    volumeDb: 0,
    volumeMul: 1,
    syncOffsetMs: 0,
    levels: [],
  };
}

function mergeInput(current: InputState, p: InputStatePartial): InputState {
  // Per-field nullish-coalesce so a meter event carrying only { name, levels }
  // does not clobber muted/volumeMul, and a mute event carrying only { name,
  // muted } does not zero out levels.
  return {
    name: p.name,
    kind: p.kind ?? current.kind,
    muted: p.muted ?? current.muted,
    volumeDb: p.volumeDb ?? current.volumeDb,
    volumeMul: p.volumeMul ?? current.volumeMul,
    syncOffsetMs: p.syncOffsetMs ?? current.syncOffsetMs,
    levels: p.levels ?? current.levels,
  };
}

function mergeInputs(
  current: readonly InputState[],
  partials: readonly InputStatePartial[]
): InputState[] {
  // Inputs are keyed by name. Updates merge into the existing entry; new
  // names append. Inputs not mentioned in the partial keep their current
  // state — meter events name only the inputs that have audio activity, so
  // partial-mention is the common case.
  const byName = new Map(current.map((i) => [i.name, i]));
  for (const p of partials) {
    const existing = byName.get(p.name) ?? defaultInput(p.name);
    byName.set(p.name, mergeInput(existing, p));
  }
  return Array.from(byName.values());
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
    // Most diff fields shallow-overwrite. `outputs` and `inputs` are the
    // exceptions — both carry partial updates that must be merged per-key
    // (output sibling, input name) so a single event cannot clobber state
    // it never spoke about.
    const merged: InstanceState = {
      ...current,
      ...diff,
      connId: current.connId,
      outputs: diff.outputs ? mergeOutputs(current.outputs, diff.outputs) : current.outputs,
      inputs: diff.inputs ? mergeInputs(current.inputs, diff.inputs) : current.inputs,
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
