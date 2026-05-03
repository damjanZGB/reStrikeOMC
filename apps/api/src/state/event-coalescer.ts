import type { InstanceStateDiff, InputState } from '@restrike/shared';

export const FLUSH_INTERVAL_MS = 33;

const HIGH_PRIORITY_EVENTS = new Set([
  'CurrentProgramSceneChanged',
  'CurrentPreviewSceneChanged',
  'StudioModeStateChanged',
  'StreamStateChanged',
  'RecordStateChanged',
  'ReplayBufferStateChanged',
  'VirtualcamStateChanged',
  'SceneListChanged',
]);

export type FlushFn = (diff: InstanceStateDiff) => void;

export class EventCoalescer {
  private readonly buffers = new Map<string, InstanceStateDiff>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly flush: FlushFn,
    private readonly intervalMs: number = FLUSH_INTERVAL_MS
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(connId: string, eventType: string, eventData: any): void {
    const partial = this.translate(connId, eventType, eventData);
    if (!partial) return;
    if (HIGH_PRIORITY_EVENTS.has(eventType)) {
      this.flushNow(connId, partial);
      return;
    }
    this.buffer(connId, partial);
  }

  applySnapshot(connId: string, snap: Partial<InstanceStateDiff>): void {
    this.flushNow(connId, { connId, ...snap });
  }

  private buffer(connId: string, partial: InstanceStateDiff): void {
    const existing = this.buffers.get(connId);
    this.buffers.set(connId, { ...(existing ?? { connId }), ...partial });
    this.ensureTimer();
  }

  private flushNow(connId: string, partial: InstanceStateDiff): void {
    const buffered = this.buffers.get(connId);
    if (buffered) {
      this.buffers.delete(connId);
      this.flush({ ...buffered, ...partial });
    } else {
      this.flush(partial);
    }
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const [connId, diff] of this.buffers) {
        this.flush(diff);
        this.buffers.delete(connId);
      }
      if (this.buffers.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }, this.intervalMs);
    this.timer.unref?.();
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.buffers.clear();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private translate(connId: string, eventType: string, ev: any): InstanceStateDiff | null {
    switch (eventType) {
      case 'CurrentProgramSceneChanged':
        return { connId, currentProgramScene: ev.sceneName };
      case 'CurrentPreviewSceneChanged':
        return { connId, currentPreviewScene: ev.sceneName };
      case 'StudioModeStateChanged':
        return { connId, studioMode: !!ev.studioModeEnabled };
      case 'InputMuteStateChanged':
        return { connId, inputs: [] };
      case 'InputVolumeChanged':
        return { connId, inputs: [] };
      case 'InputVolumeMeters':
        return { connId, inputs: this.translateMeters(ev.inputs) };
      case 'StreamStateChanged':
        return {
          connId,
          outputs: {
            streaming: { active: !!ev.outputActive, durationMs: 0 },
            recording: { active: false, paused: false, durationMs: 0 },
            replayBuffer: { active: false },
            virtualCam: { active: false },
          },
        };
      case 'RecordStateChanged':
        return {
          connId,
          outputs: {
            streaming: { active: false, durationMs: 0 },
            recording: {
              active: !!ev.outputActive,
              paused: !!ev.outputPaused,
              durationMs: 0,
            },
            replayBuffer: { active: false },
            virtualCam: { active: false },
          },
        };
      default:
        return null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private translateMeters(inputs: any[]): InputState[] {
    return (inputs ?? []).map((i) => ({
      name: String(i.inputName),
      kind: '',
      muted: false,
      volumeDb: 0,
      volumeMul: 0,
      syncOffsetMs: 0,
      levels: (i.inputLevelsMul ?? []).map((ch: number[]) => ({
        current: ch[0] ?? 0,
        average: ch[1] ?? 0,
        peak: ch[2] ?? 0,
      })),
    }));
  }
}
