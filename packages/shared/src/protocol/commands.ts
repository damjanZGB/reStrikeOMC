import { z } from 'zod';

const SceneNamePayload = z.object({ sceneName: z.string().min(1) });
const InputNamePayload = z.object({ inputName: z.string().min(1) });
const Empty = z.object({}).strict();

export const COMMAND_SCHEMAS = {
  SetCurrentProgramScene: SceneNamePayload,
  SetCurrentPreviewScene: SceneNamePayload,
  SetStudioModeEnabled: z.object({ enabled: z.boolean() }),
  TransitionToProgram: z.object({
    transitionName: z.string().optional(),
    transitionDurationMs: z.number().int().nonnegative().optional(),
  }),
  SetCurrentSceneTransition: z.object({ transitionName: z.string().min(1) }),
  SetCurrentSceneTransitionDuration: z.object({
    transitionDurationMs: z.number().int().min(50).max(20000),
  }),
  SetSceneItemEnabled: z.object({
    sceneName: z.string().min(1),
    sceneItemId: z.number().int().nonnegative(),
    sceneItemEnabled: z.boolean(),
  }),
  SetInputMute: InputNamePayload.extend({ muted: z.boolean() }),
  SetInputVolume: z
    .object({
      inputName: z.string().min(1),
      volumeMul: z.number().nonnegative().optional(),
      volumeDb: z.number().min(-100).max(26).optional(),
    })
    .refine(
      (v) => v.volumeMul !== undefined || v.volumeDb !== undefined,
      { message: 'volumeMul or volumeDb required' }
    ),
  SetInputAudioSyncOffset: InputNamePayload.extend({
    syncOffsetMs: z.number().int().min(-20000).max(20000),
  }),
  ToggleStream: Empty,
  ToggleRecord: Empty,
  ToggleRecordPause: Empty,
  ToggleReplayBuffer: Empty,
  SaveReplayBuffer: Empty,
  ToggleVirtualCam: Empty,
  TriggerHotkeyByName: z.object({ hotkeyName: z.string().min(1) }),
  SetCurrentSceneCollection: z.object({ sceneCollectionName: z.string().min(1) }),
  SetCurrentProfile: z.object({ profileName: z.string().min(1) }),
} as const;

export type CommandName = keyof typeof COMMAND_SCHEMAS;
export type CommandPayload<N extends CommandName> = z.infer<(typeof COMMAND_SCHEMAS)[N]>;

export function isValidCommand(name: string): name is CommandName {
  return name in COMMAND_SCHEMAS;
}
