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

    const settled = await Promise.allSettled(
      input.targets.map((t) =>
        this.mgr.call(t, obsRequest, parsed.data as Record<string, unknown>)
      )
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
