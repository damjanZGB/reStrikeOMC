import type { ConnectionManager } from './connection-manager.js';
import type { AuditRepo } from '../audit/audit-repo.js';
import {
  COMMAND_SCHEMAS,
  isValidCommand,
  type CommandName,
  type FailureCode,
  type PerTargetFailure,
} from '@restrike/shared';

const ACTION_TO_OBS: Record<CommandName, string> = {
  SetCurrentProgramScene: 'SetCurrentProgramScene',
  SetCurrentPreviewScene: 'SetCurrentPreviewScene',
  SetStudioModeEnabled: 'SetStudioModeEnabled',
  TransitionToProgram: 'TriggerStudioModeTransition',
  SetCurrentSceneTransition: 'SetCurrentSceneTransition',
  SetCurrentSceneTransitionDuration: 'SetCurrentSceneTransitionDuration',
  SetSceneItemEnabled: 'SetSceneItemEnabled',
  SetInputMute: 'SetInputMute',
  SetInputVolume: 'SetInputVolume',
  SetInputAudioSyncOffset: 'SetInputAudioSyncOffset',
  ToggleStream: 'ToggleStream',
  ToggleRecord: 'ToggleRecord',
  ToggleRecordPause: 'ToggleRecordPause',
  ToggleReplayBuffer: 'ToggleReplayBuffer',
  SaveReplayBuffer: 'SaveReplayBuffer',
  ToggleVirtualCam: 'ToggleVirtualCam',
  TriggerHotkeyByName: 'TriggerHotkeyByName',
  SetCurrentSceneCollection: 'SetCurrentSceneCollection',
  SetCurrentProfile: 'SetCurrentProfile',
};

/**
 * Map our wire payload field names (terse, web-facing) to OBS Studio's expected
 * field names. obs-websocket v5 prefixes most input/audio fields with `input...`.
 * Commands without an entry pass through unchanged.
 */
type PayloadMap = (payload: Record<string, unknown>) => Record<string, unknown>;

const PAYLOAD_TRANSLATORS: Partial<Record<CommandName, PayloadMap>> = {
  SetStudioModeEnabled: (p) => ({ studioModeEnabled: p.enabled }),
  SetCurrentSceneTransitionDuration: (p) => ({ transitionDuration: p.transitionDurationMs }),
  SetInputMute: (p) => ({ inputName: p.inputName, inputMuted: p.muted }),
  SetInputVolume: (p) => {
    const out: Record<string, unknown> = { inputName: p.inputName };
    if (p.volumeMul !== undefined) out.inputVolumeMul = p.volumeMul;
    if (p.volumeDb !== undefined) out.inputVolumeDb = p.volumeDb;
    return out;
  },
  SetInputAudioSyncOffset: (p) => ({
    inputName: p.inputName,
    inputAudioSyncOffset: p.syncOffsetMs,
  }),
};

function translatePayload(
  action: CommandName,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const translator = PAYLOAD_TRANSLATORS[action];
  return translator ? translator(payload) : payload;
}

export interface DispatchInput {
  userId: string;
  action: string;
  targets: string[];
  payload: Record<string, unknown>;
}

export interface DispatchResult {
  ok: string[];
  failed: PerTargetFailure[];
}

function classifyError(err: unknown): { code: FailureCode; message: string } {
  const e = err as { code?: number; message?: string };
  if (e?.code === 600) return { code: 'SceneNotFound', message: e.message ?? 'scene not found' };
  if (e?.code === 4009) return { code: 'AuthFailed', message: 'authentication failed' };
  if (typeof e?.message === 'string' && /not connected/i.test(e.message)) {
    return { code: 'Disconnected', message: e.message };
  }
  return { code: 'Unknown', message: e?.message ?? 'unknown error' };
}

export class CommandBus {
  constructor(
    private readonly mgr: ConnectionManager,
    private readonly audit: AuditRepo
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    if (!isValidCommand(input.action)) {
      throw new Error('unknown_action');
    }
    const schema = COMMAND_SCHEMAS[input.action];
    const parsed = schema.safeParse(input.payload);
    if (!parsed.success) {
      throw new Error('invalid_payload: ' + JSON.stringify(parsed.error.issues));
    }
    const obsRequest = ACTION_TO_OBS[input.action];
    const obsPayload = translatePayload(
      input.action,
      parsed.data as Record<string, unknown>
    );

    const settled = await Promise.allSettled(
      input.targets.map((t) => this.mgr.call(t, obsRequest, obsPayload))
    );

    const ok: string[] = [];
    const failed: PerTargetFailure[] = [];
    settled.forEach((s, i) => {
      const connId = input.targets[i]!;
      if (s.status === 'fulfilled') {
        ok.push(connId);
      } else {
        const { code, message } = classifyError(s.reason);
        failed.push({ connId, code, message });
      }
    });

    this.audit.write(input.userId, input.action, input.targets, { ok, failed });
    return { ok, failed };
  }
}
