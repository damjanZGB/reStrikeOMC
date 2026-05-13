import { EventEmitter } from 'node:events';
import type { ConnectionStatus } from '@restrike/shared';
import { createObsClient, type IObsClient, type ObsProtocol } from './clients/index.js';

export interface ConnectionTarget {
  id: string;
  host: string;
  port: number;
  password: string | null;
  /**
   * Wire protocol to use for this connection. Defaults to 'v5' when omitted so
   * callers that haven't been updated yet keep the pre-feature behaviour.
   */
  protocol?: ObsProtocol;
}

interface Slot {
  target: ConnectionTarget;
  protocol: ObsProtocol;
  client: IObsClient;
  status: ConnectionStatus;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempt: number;
  closing: boolean;
}

export interface StatusEvent {
  connId: string;
  status: ConnectionStatus;
  reason?: string;
}

export interface OutputSnapshot {
  streaming: { active: boolean; durationMs: number };
  recording: { active: boolean; paused: boolean; durationMs: number };
  replayBuffer: { active: boolean };
  virtualCam: { active: boolean };
}

export interface SnapshotInput {
  name: string;
  kind: string;
  muted: boolean;
  volumeMul: number;
  volumeDb: number;
}

export interface SnapshotEvent {
  connId: string;
  currentProgramScene: string | null;
  currentPreviewScene: string | null;
  scenes: Array<{ name: string; index: number }>;
  inputs: SnapshotInput[];
  outputs: OutputSnapshot;
}

export type ConnectionManagerEvents = {
  status: [StatusEvent];
  obsEvent: [{ connId: string; eventType: string; eventData: unknown }];
  snapshot: [SnapshotEvent];
};

const FORWARDED_EVENTS = [
  'CurrentProgramSceneChanged',
  'CurrentPreviewSceneChanged',
  'StudioModeStateChanged',
  'SceneListChanged',
  'SceneItemEnableStateChanged',
  'InputMuteStateChanged',
  'InputVolumeChanged',
  'InputAudioSyncOffsetChanged',
  'InputCreated',
  'InputRemoved',
  'InputNameChanged',
  'InputVolumeMeters',
  'StreamStateChanged',
  'RecordStateChanged',
  'ReplayBufferStateChanged',
  'VirtualcamStateChanged',
  'CurrentSceneCollectionChanged',
  'CurrentProfileChanged',
] as const;

export class ConnectionManager extends EventEmitter {
  private readonly slots = new Map<string, Slot>();

  override on<K extends keyof ConnectionManagerEvents>(
    event: K,
    listener: (...args: ConnectionManagerEvents[K]) => void
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override emit<K extends keyof ConnectionManagerEvents>(
    event: K,
    ...args: ConnectionManagerEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  async add(target: ConnectionTarget): Promise<void> {
    if (this.slots.has(target.id)) return;
    const protocol: ObsProtocol = target.protocol ?? 'v5';
    const slot: Slot = {
      target,
      protocol,
      client: createObsClient(protocol),
      status: 'disconnected',
      reconnectTimer: null,
      reconnectAttempt: 0,
      closing: false,
    };
    this.slots.set(target.id, slot);
    this.wireClient(slot);
    this.setStatus(slot, 'connecting');
    void this.openOnce(slot);
  }

  private wireClient(slot: Slot): void {
    slot.client.on('ConnectionClosed', () => {
      if (slot.closing) return;
      if (slot.status !== 'auth_failed') {
        this.setStatus(slot, 'disconnected');
        this.scheduleReconnect(slot);
      }
    });
    slot.client.on('ConnectionError', () => {
      // surfaced via ConnectionClosed too — no action here
    });
    slot.client.on('Identified', () => {
      slot.reconnectAttempt = 0;
      this.setStatus(slot, 'connected');
      void this.fetchSnapshot(slot);
    });

    for (const ev of FORWARDED_EVENTS) {
      slot.client.on(ev, (eventData: unknown) => {
        this.emit('obsEvent', { connId: slot.target.id, eventType: ev, eventData });
      });
    }
  }

  private async fetchSnapshot(slot: Slot): Promise<void> {
    // Each call is independent — Promise.allSettled so a single missing/rejected
    // endpoint (e.g. an older OBS that doesn't expose GetVirtualCamStatus) does
    // not nuke the entire snapshot. Without this, *all* output statuses default
    // to off forever even though OBS may already be streaming/recording. Six
    // requests in parallel; we synthesize defaults for whatever didn't return.
    const [scene, input, stream, record, replay, virt] = await Promise.allSettled([
      slot.client.call('GetSceneList'),
      slot.client.call('GetInputList'),
      slot.client.call('GetStreamStatus'),
      slot.client.call('GetRecordStatus'),
      slot.client.call('GetReplayBufferStatus'),
      slot.client.call('GetVirtualCamStatus'),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = <T = any,>(s: PromiseSettledResult<unknown>): T | null =>
      s.status === 'fulfilled' ? (s.value as T) : null;

    type SceneListResp = {
      currentProgramSceneName?: string;
      currentPreviewSceneName?: string;
      scenes?: Array<{ sceneName: string; sceneIndex: number }>;
    };
    type InputListResp = { inputs?: Array<{ inputName: string; inputKind: string }> };
    type OutputResp = { outputActive?: boolean; outputDuration?: number; outputPaused?: boolean };

    const sceneList = ok<SceneListResp>(scene);
    const inputList = ok<InputListResp>(input);
    const streamStatus = ok<OutputResp>(stream);
    const recordStatus = ok<OutputResp>(record);
    const replayStatus = ok<OutputResp>(replay);
    const virtStatus = ok<OutputResp>(virt);

    if (!sceneList && !inputList && !streamStatus && !recordStatus && !replayStatus && !virtStatus) {
      // All six failed — almost certainly not connected; nothing useful to emit.
      return;
    }

    // Second fan-out: per-input mute and volume. We call these for every input
    // — non-audio sources will reject (OBS returns code 604), Promise.allSettled
    // absorbs the rejection, and we fall back to defaults for that input.
    // Without this, the dashboard renders every audio source at 100% unmuted
    // regardless of what OBS actually has set.
    const rawInputs = inputList?.inputs ?? [];
    type MuteResp = { inputMuted?: boolean };
    type VolResp = { inputVolumeMul?: number; inputVolumeDb?: number };
    const audioStates = await Promise.allSettled(
      rawInputs.map(async (i) => {
        const name = String(i.inputName);
        const [mute, vol] = await Promise.allSettled([
          slot.client.call('GetInputMute', { inputName: name }),
          slot.client.call('GetInputVolume', { inputName: name }),
        ]);
        const muteVal = mute.status === 'fulfilled' ? (mute.value as MuteResp) : null;
        const volVal = vol.status === 'fulfilled' ? (vol.value as VolResp) : null;
        return {
          name,
          kind: String(i.inputKind),
          muted: !!muteVal?.inputMuted,
          volumeMul: Number(volVal?.inputVolumeMul ?? 1),
          volumeDb: Number(volVal?.inputVolumeDb ?? 0),
        };
      })
    );

    const inputs: SnapshotInput[] = audioStates.flatMap((s, idx) => {
      if (s.status === 'fulfilled') return [s.value];
      // The whole pair rejected (e.g. input was removed mid-fetch). Fall back
      // to name+kind only, defaults for the audio fields.
      return [
        {
          name: String(rawInputs[idx]?.inputName ?? ''),
          kind: String(rawInputs[idx]?.inputKind ?? ''),
          muted: false,
          volumeMul: 1,
          volumeDb: 0,
        },
      ];
    });

    this.emit('snapshot', {
      connId: slot.target.id,
      currentProgramScene: sceneList?.currentProgramSceneName ?? null,
      currentPreviewScene: sceneList?.currentPreviewSceneName ?? null,
      scenes: (sceneList?.scenes ?? []).map((s) => ({
        name: String(s.sceneName),
        index: Number(s.sceneIndex),
      })),
      inputs,
      outputs: {
        streaming: {
          active: !!streamStatus?.outputActive,
          durationMs: Number(streamStatus?.outputDuration ?? 0),
        },
        recording: {
          active: !!recordStatus?.outputActive,
          paused: !!recordStatus?.outputPaused,
          durationMs: Number(recordStatus?.outputDuration ?? 0),
        },
        replayBuffer: { active: !!replayStatus?.outputActive },
        virtualCam: { active: !!virtStatus?.outputActive },
      },
    });
  }

  private async openOnce(slot: Slot): Promise<void> {
    const url = `ws://${slot.target.host}:${slot.target.port}`;
    try {
      await slot.client.connect(url, slot.target.password ?? undefined, {});
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 4009) {
        this.setStatus(slot, 'auth_failed', 'invalid password');
        return;
      }
      this.setStatus(slot, 'disconnected', String(err));
      this.scheduleReconnect(slot);
    }
  }

  private scheduleReconnect(slot: Slot): void {
    if (slot.closing || slot.status === 'auth_failed') return;
    if (slot.reconnectTimer) return;
    slot.reconnectAttempt += 1;
    const baseMs = Math.min(30_000, 1000 * 2 ** (slot.reconnectAttempt - 1));
    const jitter = Math.floor(Math.random() * 250);
    slot.reconnectTimer = setTimeout(() => {
      slot.reconnectTimer = null;
      this.setStatus(slot, 'connecting');
      void this.openOnce(slot);
    }, baseMs + jitter);
  }

  private setStatus(slot: Slot, status: ConnectionStatus, reason?: string): void {
    if (slot.status === status) return;
    slot.status = status;
    this.emit('status', { connId: slot.target.id, status, reason });
  }

  getStatus(id: string): ConnectionStatus | null {
    return this.slots.get(id)?.status ?? null;
  }

  async waitForStatus(
    id: string,
    status: ConnectionStatus,
    timeoutMs: number
  ): Promise<void> {
    const slot = this.slots.get(id);
    if (!slot) throw new Error(`unknown conn ${id}`);
    if (slot.status === status) return;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        this.off('status', onStatus);
        reject(new Error(`timeout waiting for ${status}, last=${slot.status}`));
      }, timeoutMs);
      const onStatus = (e: StatusEvent): void => {
        if (e.connId === id && e.status === status) {
          clearTimeout(t);
          this.off('status', onStatus);
          resolve();
        }
      };
      this.on('status', onStatus);
    });
  }

  async call(
    connId: string,
    requestType: string,
    requestData: Record<string, unknown>
  ): Promise<unknown> {
    const slot = this.slots.get(connId);
    if (!slot) throw new Error(`unknown conn ${connId}`);
    if (slot.status !== 'connected') {
      throw new Error(`conn ${connId} not connected (status=${slot.status})`);
    }
    return slot.client.call(requestType, requestData);
  }

  async remove(id: string): Promise<void> {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.closing = true;
    if (slot.reconnectTimer) clearTimeout(slot.reconnectTimer);
    try {
      await slot.client.disconnect();
    } catch {
      // ignore
    }
    this.slots.delete(id);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.slots.keys()].map((id) => this.remove(id)));
  }
}
